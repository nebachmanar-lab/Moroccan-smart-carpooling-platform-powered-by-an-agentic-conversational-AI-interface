import os
import asyncio
from groq import AsyncGroq
from huggingface_hub import InferenceClient

MODEL = "llama-3.3-70b-versatile"

# Mots courants en Darija pour la détection manuelle (fallback)
DARIJA_KEYWORDS = [
    "bghit", "bgha", "mashi", "wach", "fin", "mnin", "imta", "shkhal",
    "dyali", "dyal", "zwina", "mzyan", "bzzaf", "shwiya", "khouya", "lah",
    "nta", "nti", "hna", "huma", "daba", "ghda", "lbara7", "f", "mn",
    "wlakin", "ila", "ach", "ash", "wakha", "mezyan", "sir", "aji"
]


def _is_darija(text: str) -> bool:
    """
    Détecte si le texte est en Darija.
    Utilise langdetect d'abord, puis un fallback par mots-clés.
    """
    text_lower = text.lower()

    # Fallback rapide par mots-clés Darija
    darija_count = sum(1 for word in DARIJA_KEYWORDS if word in text_lower.split())
    if darija_count >= 2:
        return True

    # Utilise langdetect si disponible
    try:
        from langdetect import detect
        lang = detect(text)
        # langdetect détecte souvent Darija comme 'ar' ou 'fr' avec bruit
        # On fait confiance aux mots-clés en priorité
        return False
    except Exception:
        return False


async def _translate_darija_to_french(text: str) -> str:
    """
    Traduit le texte Darija en Français via Atlas-Chat (HuggingFace Inference API).
    Retourne le texte original si la traduction échoue.
    """
    hf_token = os.getenv("HF_TOKEN")
    if not hf_token:
        print("[WARNING] HF_TOKEN non défini, traduction Darija ignorée")
        return text

    try:
        client = InferenceClient(
            model="MBZUAI-Paris/Atlas-Chat-9B",
            token=hf_token,
        )

        response = client.chat_completion(
            messages=[{
                "role": "user",
                "content": (
                    f"Traduis ce texte en français. "
                    f"Réponds uniquement avec la traduction, sans explication:\n{text}"
                )
            }],
            max_tokens=300,
        )
        translated = response.choices[0].message.content.strip()
        print(f"[Atlas-Chat] '{text}' → '{translated}'")
        return translated

    except Exception as e:
        print(f"[WARNING] Atlas-Chat translation failed: {e}")
        return text  # Retourne l'original si ça échoue


async def call_llm(messages: list[dict], system: str = None) -> str:
    """
    Appelle Groq pour extraire les entités.
    Si le dernier message utilisateur est en Darija,
    Atlas-Chat le traduit d'abord en Français.
    """
    # Trouver le dernier message utilisateur
    processed_messages = []
    for msg in messages:
        if msg["role"] == "user":
            content = msg["content"]
            # Détecter et traduire si nécessaire
            if _is_darija(content):
                print(f"[Routing] Darija détectée → Atlas-Chat")
                content = await _translate_darija_to_french(content)
            else:
                print(f"[Routing] FR/EN/AR → Groq directement")
            processed_messages.append({"role": "user", "content": content})
        else:
            processed_messages.append(msg)

    # Appel Groq avec les messages traités
    client = AsyncGroq(api_key=os.getenv("GROQ_API_KEY"))

    chat_messages = [{"role": "system", "content": system}] if system else []
    chat_messages += [{"role": m["role"], "content": m["content"]} for m in processed_messages]

    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = await client.chat.completions.create(
                model=MODEL,
                messages=chat_messages,
                temperature=0.2,
            )
            return response.choices[0].message.content
        except Exception as exc:
            err = str(exc)
            if "429" in err and attempt < max_retries - 1:
                await asyncio.sleep(2 ** attempt)
                continue
            if "429" in err:
                raise RuntimeError(
                    "Quota Groq dépassé. Attendez quelques secondes et réessayez."
                ) from exc
            raise