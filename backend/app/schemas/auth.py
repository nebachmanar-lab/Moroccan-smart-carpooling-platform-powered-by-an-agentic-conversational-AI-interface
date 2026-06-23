# app/schemas/auth.py

from pydantic import BaseModel, EmailStr
from typing import Literal, Optional


class UserRegister(BaseModel):
    first_name: str
    last_name: str
    email: EmailStr
    password: str
    phone: Optional[str] = None
    # Must match the Role enum values in models/user.py exactly
    role: Literal["PASSENGER", "DRIVER"] = "PASSENGER"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    first_name: str
    last_name: str
    email: str
    phone: Optional[str] = None
    role: str
    is_verified: bool = False
    is_phone_verified: bool = False

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None