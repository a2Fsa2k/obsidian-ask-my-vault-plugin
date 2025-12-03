import os
import hashlib
import json
from typing import List, Dict, Any, Optional
from pathlib import Path
from datetime import datetime
import asyncio

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer
import httpx

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state
embedding_model = None
chroma_client = None
collection = None
file_hashes = {}
pending_updates = []
update_lock = asyncio.Lock()


class QueryRequest(BaseModel):
    question: str
    provider: str
    base_url: str
    api_key: str
    model: str
    temperature: float
    system_prompt: str
    top_k: int = 5


class IndexRequest(BaseModel):
    file_path: str
    content: str


class RebuildRequest(BaseModel):
    vault_path: str


class ProviderConfig(BaseModel):
    provider: str
    base_url: str
    api_key: str
    model: str
    temperature: float


def init_services():
    global embedding_model, chroma_client, collection
    
    if embedding_model is None:
        embedding_model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')
    
    if chroma_client is None:
        persist_dir = os.path.join(os.path.dirname(__file__), "chroma_db")
        os.makedirs(persist_dir, exist_ok=True)
        chroma_client = chromadb.PersistentClient(path=persist_dir)
        collection = chroma_client.get_or_create_collection(name="obsidian_notes")
        
        # Load file hashes
        hash_file = os.path.join(persist_dir, "file_hashes.json")
        if os.path.exists(hash_file):
            with open(hash_file, 'r') as f:
                file_hashes.update(json.load(f))


def save_file_hashes():
    persist_dir = os.path.join(os.path.dirname(__file__), "chroma_db")
    hash_file = os.path.join(persist_dir, "file_hashes.json")
    with open(hash_file, 'w') as f:
        json.dump(file_hashes, f)


def compute_hash(content: str) -> str:
    return hashlib.sha256(content.encode('utf-8')).hexdigest()


def chunk_text(text: str, max_tokens: int = 700) -> List[str]:
    # Simple paragraph-based chunking
    paragraphs = text.split('\n\n')
    chunks = []
    current_chunk = []
    current_length = 0
    
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        
        para_length = len(para.split())
        
        if current_length + para_length > max_tokens and current_chunk:
            chunks.append('\n\n'.join(current_chunk))
            current_chunk = [para]
            current_length = para_length
        else:
            current_chunk.append(para)
            current_length += para_length
    
    if current_chunk:
        chunks.append('\n\n'.join(current_chunk))
    
    return chunks


def index_file(file_path: str, content: str):
    init_services()
    
    content_hash = compute_hash(content)
    
    # Extract relative path (just filename for display)
    relative_path = Path(file_path).name
    
    # Check if file needs reindexing
    if file_path in file_hashes and file_hashes[file_path] == content_hash:
        return
    
    # Delete old chunks for this file
    try:
        existing = collection.get(where={"file_path": relative_path})
        if existing['ids']:
            collection.delete(ids=existing['ids'])
    except:
        pass
    
    # Chunk and embed
    chunks = chunk_text(content)
    if not chunks:
        return
    
    embeddings = embedding_model.encode(chunks).tolist()
    
    ids = [f"{relative_path}_{i}" for i in range(len(chunks))]
    metadatas = [{"file_path": relative_path, "chunk_index": i, "full_path": file_path} for i in range(len(chunks))]
    
    collection.add(
        ids=ids,
        embeddings=embeddings,
        documents=chunks,
        metadatas=metadatas
    )
    
    file_hashes[file_path] = content_hash
    save_file_hashes()


def delete_file_from_index(file_path: str):
    init_services()
    
    relative_path = Path(file_path).name
    
    try:
        existing = collection.get(where={"file_path": relative_path})
        if existing['ids']:
            collection.delete(ids=existing['ids'])
        
        if file_path in file_hashes:
            del file_hashes[file_path]
            save_file_hashes()
    except:
        pass


async def call_provider(config: ProviderConfig, messages: List[Dict[str, str]]) -> str:
    provider = config.provider.lower()
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        if provider == "anthropic":
            headers = {
                "x-api-key": config.api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            }
            
            # Convert messages format
            anthropic_messages = []
            system_content = ""
            
            for msg in messages:
                if msg["role"] == "system":
                    system_content = msg["content"]
                else:
                    anthropic_messages.append({
                        "role": msg["role"],
                        "content": msg["content"]
                    })
            
            body = {
                "model": config.model,
                "messages": anthropic_messages,
                "max_tokens": 4096,
                "temperature": config.temperature
            }
            
            if system_content:
                body["system"] = system_content
            
            url = f"{config.base_url}/v1/messages"
            response = await client.post(url, headers=headers, json=body)
            response.raise_for_status()
            data = response.json()
            return data["content"][0]["text"]
        
        elif provider in ["openai", "mistral", "custom", "local"]:
            headers = {
                "Content-Type": "application/json"
            }
            
            if config.api_key:
                headers["Authorization"] = f"Bearer {config.api_key}"
            
            body = {
                "model": config.model,
                "messages": messages,
                "temperature": config.temperature
            }
            
            if provider == "local":
                # Try llama.cpp first, then Ollama
                if "8080" in config.base_url:
                    url = f"{config.base_url}/v1/chat/completions"
                else:
                    url = f"{config.base_url}/api/chat"
                    body = {
                        "model": config.model,
                        "messages": messages,
                        "stream": False
                    }
            else:
                url = f"{config.base_url}/v1/chat/completions"
            
            response = await client.post(url, headers=headers, json=body)
            response.raise_for_status()
            data = response.json()
            
            if provider == "local" and "11434" in config.base_url:
                return data["message"]["content"]
            else:
                return data["choices"][0]["message"]["content"]
        
        elif provider == "google":
            # Gemini API
            headers = {
                "Content-Type": "application/json"
            }
            
            url = f"{config.base_url}/v1beta/models/{config.model}:generateContent?key={config.api_key}"
            
            # Convert messages to Gemini format
            contents = []
            system_instruction = ""
            
            for msg in messages:
                if msg["role"] == "system":
                    system_instruction = msg["content"]
                else:
                    role = "user" if msg["role"] == "user" else "model"
                    contents.append({
                        "role": role,
                        "parts": [{"text": msg["content"]}]
                    })
            
            body = {
                "contents": contents,
                "generationConfig": {
                    "temperature": config.temperature,
                    "maxOutputTokens": 4096
                }
            }
            
            if system_instruction:
                body["systemInstruction"] = {
                    "parts": [{"text": system_instruction}]
                }
            
            response = await client.post(url, headers=headers, json=body)
            response.raise_for_status()
            data = response.json()
            return data["candidates"][0]["content"]["parts"][0]["text"]
        
        else:
            raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")


@app.on_event("startup")
async def startup():
    init_services()


@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


@app.get("/status")
async def status():
    init_services()
    return {
        "indexed_files": len(file_hashes),
        "total_chunks": collection.count() if collection else 0
    }


@app.post("/index")
async def index_endpoint(req: IndexRequest):
    try:
        index_file(req.file_path, req.content)
        return {"status": "indexed", "file_path": req.file_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/index/{file_path:path}")
async def delete_endpoint(file_path: str):
    try:
        delete_file_from_index(file_path)
        return {"status": "deleted", "file_path": file_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/rebuild")
async def rebuild_endpoint(req: RebuildRequest):
    try:
        init_services()
        
        # Clear collection
        try:
            all_ids = collection.get()['ids']
            if all_ids:
                collection.delete(ids=all_ids)
        except:
            pass
        file_hashes.clear()
        save_file_hashes()
        
        # Scan vault and index all markdown files
        vault_path = Path(req.vault_path)
        indexed_count = 0
        
        for md_file in vault_path.rglob("*.md"):
            if md_file.is_file():
                content = md_file.read_text(encoding='utf-8')
                index_file(str(md_file), content)
                indexed_count += 1
        
        return {
            "status": "rebuilt",
            "indexed_files": indexed_count,
            "total_chunks": collection.count()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/query")
async def query_endpoint(req: QueryRequest):
    try:
        init_services()
        
        # Embed question
        question_embedding = embedding_model.encode([req.question])[0].tolist()
        
        # Search
        results = collection.query(
            query_embeddings=[question_embedding],
            n_results=req.top_k,
            include=['documents', 'metadatas', 'distances']
        )
        
        # Build context with relevance filtering
        sources = []
        context_parts = []
        seen_files = set()
        
        # Similarity threshold - lower distance = more similar
        # Cosine distance typically ranges 0-2, lower is better
        # 1.6 allows moderately related content while filtering noise
        SIMILARITY_THRESHOLD = 1.6
        
        if results['documents'] and results['documents'][0]:
            for i, doc in enumerate(results['documents'][0]):
                metadata = results['metadatas'][0][i]
                distance = results['distances'][0][i] if 'distances' in results and results['distances'] else 0
                
                # Skip if not similar enough
                if distance > SIMILARITY_THRESHOLD:
                    continue
                
                file_path = metadata['file_path']
                
                # Add to context
                context_parts.append(f"[Source: {file_path}]\n{doc}")
                
                # Add to sources (one entry per file, not per chunk)
                if file_path not in seen_files:
                    seen_files.add(file_path)
                    sources.append({
                        "file_path": file_path,
                        "snippet": doc[:200],
                        "relevance": round(1.0 - (distance / 2.0), 2)  # Convert to 0-1 score
                    })
        
        context = "\n\n".join(context_parts)
        
        # Build messages
        messages = []
        
        if req.system_prompt:
            messages.append({
                "role": "system",
                "content": req.system_prompt
            })
        
        user_message = f"Context from knowledge base:\n\n{context}\n\nQuestion: {req.question}"
        messages.append({
            "role": "user",
            "content": user_message
        })
        
        # Call provider
        provider_config = ProviderConfig(
            provider=req.provider,
            base_url=req.base_url,
            api_key=req.api_key,
            model=req.model,
            temperature=req.temperature
        )
        
        answer = await call_provider(provider_config, messages)
        
        return {
            "answer": answer,
            "sources": sources
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
