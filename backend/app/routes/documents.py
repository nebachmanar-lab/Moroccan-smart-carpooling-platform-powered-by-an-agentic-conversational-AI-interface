import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User, Role
from app.models.document import DriverDocument, DocType, DocStatus

router = APIRouter(prefix="/documents", tags=["documents"])

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploads", "documents")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
MAX_SIZE_MB = 5


@router.post("", status_code=201)
async def upload_document(
    doc_type: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != Role.DRIVER:
        raise HTTPException(status_code=403, detail="Réservé aux conducteurs")
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Format non supporté (JPEG, PNG, WebP, PDF)")

    content = await file.read()
    if len(content) > MAX_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"Fichier trop volumineux (max {MAX_SIZE_MB} Mo)")

    try:
        dtype = DocType(doc_type.upper())
    except ValueError:
        raise HTTPException(status_code=400, detail="Type de document invalide (CIN ou PERMIS)")

    ext = os.path.splitext(file.filename or "doc")[1] or ".jpg"
    filename = f"{uuid.uuid4()}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
    with open(path, "wb") as f:
        f.write(content)

    doc = DriverDocument(
        driver_id=current_user.id,
        doc_type=dtype,
        file_path=filename,
        original_name=file.filename or filename,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return _serialize(doc)


@router.get("/me")
async def my_documents(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(DriverDocument)
        .where(DriverDocument.driver_id == current_user.id)
        .order_by(DriverDocument.created_at.desc())
    )
    return [_serialize(d) for d in result.scalars().all()]


@router.get("/admin/all")
async def admin_list_documents(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")
    result = await db.execute(
        select(DriverDocument).order_by(DriverDocument.created_at.desc())
    )
    docs = result.scalars().all()
    out = []
    for d in docs:
        driver_res = await db.execute(select(User).where(User.id == d.driver_id))
        driver = driver_res.scalar_one_or_none()
        item = _serialize(d)
        item["driver_name"] = f"{driver.first_name} {driver.last_name}" if driver else "?"
        item["driver_email"] = driver.email if driver else ""
        out.append(item)
    return out


@router.patch("/admin/{doc_id}")
async def admin_review_document(
    doc_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")
    result = await db.execute(select(DriverDocument).where(DriverDocument.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document introuvable")
    status_str = body.get("status", "").upper()
    try:
        doc.status = DocStatus(status_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Statut invalide")
    if "admin_note" in body:
        doc.admin_note = body["admin_note"]
    await db.commit()
    return _serialize(doc)


def _serialize(d: DriverDocument) -> dict:
    return {
        "id": d.id,
        "driver_id": d.driver_id,
        "doc_type": d.doc_type.value if hasattr(d.doc_type, "value") else str(d.doc_type),
        "original_name": d.original_name,
        "file_url": f"/uploads/documents/{d.file_path}",
        "status": d.status.value if hasattr(d.status, "value") else str(d.status),
        "admin_note": d.admin_note,
        "created_at": d.created_at.isoformat() if d.created_at else None,
    }
