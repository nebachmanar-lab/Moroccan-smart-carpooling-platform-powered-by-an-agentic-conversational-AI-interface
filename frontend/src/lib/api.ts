const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";

async function tryRefresh(): Promise<string | null> {
    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) return null;

    try {
        const res = await fetch(`${API}/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        localStorage.setItem("access_token", data.access_token);
        localStorage.setItem("refresh_token", data.refresh_token);
        return data.access_token;
    } catch {
        return null;
    }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = localStorage.getItem("access_token");
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);

    let res = await fetch(`${API}${path}`, { ...init, headers });

    if (res.status === 401) {
        const newToken = await tryRefresh();
        if (newToken) {
            headers.set("Authorization", `Bearer ${newToken}`);
            res = await fetch(`${API}${path}`, { ...init, headers });
        } else {
            localStorage.removeItem("access_token");
            localStorage.removeItem("refresh_token");
            localStorage.removeItem("token_type");
            window.location.href = "/login";
        }
    }

    return res;
}
