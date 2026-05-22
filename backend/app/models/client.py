from datetime import datetime

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    plan: Mapped[str] = mapped_column(String(40), default="starter")
    company_email: Mapped[str | None] = mapped_column(String(180), nullable=True)
    company_phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    document: Mapped[str | None] = mapped_column(String(80), nullable=True)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    install_key: Mapped[str | None] = mapped_column(String(80), unique=True, index=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
