const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";

// Use sessionStorage so each browser tab has its own independent session.
// This prevents multiple open windows from overwriting each other's tokens.
const store = typeof window !== "undefined" ? window.sessionStorage : null;
const getToken = (key: string) => store?.getItem(key) ?? null;
const setToken = (key: string, val: string) => store?.setItem(key, val);
const clearTokens = () => { store?.removeItem("access_token"); store?.removeItem("refresh_token"); store?.removeItem("token_type"); };

function networkErrorResponse() {
    return new Response(JSON.stringify({ detail: "Service temporairement indisponible." }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
    });
}

async function tryRefresh(): Promise<string | null> {
    const refreshToken = getToken("refresh_token");
    if (!refreshToken) return null;

    try {
        const res = await fetch(`${API}/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        setToken("access_token", data.access_token);
        setToken("refresh_token", data.refresh_token);
        return data.access_token;
    } catch {
        return null;
    }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = getToken("access_token");
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);

    let res: Response;
    try {
        res = await fetch(`${API}${path}`, { ...init, headers });
    } catch {
        return networkErrorResponse();
    }

    if (res.status === 401) {
        const newToken = await tryRefresh();
        if (newToken) {
            headers.set("Authorization", `Bearer ${newToken}`);
            try {
                res = await fetch(`${API}${path}`, { ...init, headers });
            } catch {
                return networkErrorResponse();
            }
        } else {
            clearTokens();
            window.location.href = "/login";
            return new Response(null, { status: 401 });
        }
    }

    return res;
}
