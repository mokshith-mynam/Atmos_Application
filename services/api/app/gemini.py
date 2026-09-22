"""Google Gemini authority-briefing adapter.

The API key stays on the server and is optional. When it is not configured,
the endpoint returns a clearly labelled deterministic briefing so the demo
remains usable offline.
"""
from __future__ import annotations

import os
from typing import Any

import httpx


SUPPORTED_LANGUAGES = {
    "English": "English",
    "Hindi": "Hindi (Devanagari script)",
    "Portuguese": "Brazilian Portuguese",
    "Russian": "Russian",
    "Chinese": "Simplified Chinese",
}


def _fallback_briefing(alert: Any, hotspot: Any, language: str, reason: str) -> dict[str, Any]:
    return {
        "provider": "local-demo",
        "model": "deterministic-safety-brief-v1",
        "mode": "demo-fallback",
        "language": language,
        "briefing": (
            f"{alert.severity.upper()} alert: {alert.title}. PM2.5 is elevated near "
            f"{hotspot.region}; likely source: {alert.likely_source}. "
            f"Prioritize {alert.recommended_actions[0].lower()}. "
            "This machine-generated briefing requires authorized human review before action."
        ),
        "disclosure": reason,
    }


async def generate_authority_briefing(alert: Any, hotspot: Any, language: str = "English") -> dict[str, Any]:
    """Generate a concise public-safety briefing from already-normalized evidence."""
    language_name = SUPPORTED_LANGUAGES.get(language, "English")
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return _fallback_briefing(
            alert,
            hotspot,
            language,
            "Gemini is not configured. Set GEMINI_API_KEY to enable Google AI generation.",
        )

    evidence = "; ".join(
        f"{item.source_type.value}: {item.summary} ({item.confidence:.0%} confidence)"
        for item in hotspot.evidence
    )
    prompt = f"""You are an air-quality public-safety assistant for BRICS authorities.
Write a concise, factual briefing in {language_name}. Use only the supplied facts.
Do not invent measurements, locations, legal claims, or instructions. State that human
authorization is required before enforcement. Keep it below 140 words.

Incident: {alert.title}
Severity: {alert.severity}
Likely source: {alert.likely_source}
Affected regions: {', '.join(alert.affected_regions)}
Recommended actions: {'; '.join(alert.recommended_actions)}
Evidence: {evidence}
"""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
                headers={"x-goog-api-key": api_key},
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.2, "maxOutputTokens": 800},
                },
            )
            response.raise_for_status()
            body = response.json()
        briefing = body["candidates"][0]["content"]["parts"][0]["text"].strip()
        if not briefing:
            raise ValueError("Gemini returned no text")
        return {
            "provider": "Google Gemini API",
            "model": "gemini-3.6-flash",
            "mode": "live",
            "language": language,
            "briefing": briefing,
            "disclosure": "Generated from normalized incident evidence; human authorization is required before enforcement.",
        }
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
        return _fallback_briefing(
            alert,
            hotspot,
            language,
            f"Gemini request unavailable ({type(exc).__name__}); showing a deterministic fallback.",
        )
