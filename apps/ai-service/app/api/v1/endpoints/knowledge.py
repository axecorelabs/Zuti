from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from app.services.ingestion_service import ingestion_service

router = APIRouter()


class IngestUrlRequest(BaseModel):
    organization_id: str
    knowledge_file_id: str
    url: str
    name: str


class IngestTextRequest(BaseModel):
    organization_id: str
    knowledge_file_id: str
    name: str
    text: str


class IngestStatusResponse(BaseModel):
    knowledge_file_id: str
    status: str
    chunk_count: int = 0


class KnowledgeItemResponse(BaseModel):
    knowledge_file_id: str
    name: str
    source_type: str
    source_url: str | None = None
    chunk_count: int
    ingested_at: str


@router.post("/ingest/url", response_model=IngestStatusResponse)
async def ingest_url(request: IngestUrlRequest):
    try:
        chunk_count = await ingestion_service.ingest_url(
            organization_id=request.organization_id,
            knowledge_file_id=request.knowledge_file_id,
            url=request.url,
            name=request.name,
        )
        return IngestStatusResponse(
            knowledge_file_id=request.knowledge_file_id,
            status="completed",
            chunk_count=chunk_count,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ingest/text", response_model=IngestStatusResponse)
async def ingest_text(request: IngestTextRequest):
    try:
        chunk_count = await ingestion_service.ingest_plain_text(
            organization_id=request.organization_id,
            knowledge_file_id=request.knowledge_file_id,
            name=request.name,
            text=request.text,
        )
        return IngestStatusResponse(
            knowledge_file_id=request.knowledge_file_id,
            status="completed",
            chunk_count=chunk_count,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ingest/file", response_model=IngestStatusResponse)
async def ingest_file(
    file: UploadFile = File(...),
    organization_id: str = Form(...),
    knowledge_file_id: str = Form(...),
):
    try:
        content = await file.read()
        chunk_count = await ingestion_service.ingest_bytes(
            organization_id=organization_id,
            knowledge_file_id=knowledge_file_id,
            content=content,
            filename=file.filename or "upload",
            content_type=file.content_type or "application/octet-stream",
        )
        return IngestStatusResponse(
            knowledge_file_id=knowledge_file_id,
            status="completed",
            chunk_count=chunk_count,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{organization_id}/items", response_model=list[KnowledgeItemResponse])
async def list_knowledge_items(organization_id: str):
    try:
        return await ingestion_service.list_knowledge_items(organization_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{organization_id}/items/{knowledge_file_id}")
async def delete_knowledge_item(organization_id: str, knowledge_file_id: str):
    try:
        deleted = await ingestion_service.delete_knowledge_item(organization_id, knowledge_file_id)
        return {
            "deleted": deleted,
            "organization_id": organization_id,
            "knowledge_file_id": knowledge_file_id,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{organization_id}")
async def delete_knowledge(organization_id: str):
    await ingestion_service.delete_collection(organization_id)
    return {"deleted": True, "organization_id": organization_id}
