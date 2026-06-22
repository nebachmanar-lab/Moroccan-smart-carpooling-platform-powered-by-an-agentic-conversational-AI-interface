from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel

class PreferencesCreate(BaseModel):
    smoking_allowed:    bool                                              = False
    pets_allowed:       bool                                              = False
    music_allowed:      bool                                              = True
    talking_preference: Literal["quiet","moderate","chatty","no_preference"] = "no_preference"
    luggage_size:       Literal["small","medium","large"]                 = "medium"
    air_conditioning:   bool                                              = True
    custom_note:        Optional[str]                                     = None

class PreferencesOut(BaseModel):
    id:                 str
    driver_id:          str
    smoking_allowed:    bool
    pets_allowed:       bool
    music_allowed:      bool
    talking_preference: str
    luggage_size:       str
    air_conditioning:   bool
    custom_note:        Optional[str]
    updated_at:         datetime

    model_config = {"from_attributes": True}