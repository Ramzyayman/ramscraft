import axios from 'axios';

// Optional API token support. When RamsCraft is fronted by nginx/RamsesHub (the
// production model) no token is configured and none of this fires. For a
// standalone/networked instance protected by RAMSCRAFT_API_TOKEN, the operator's
// token is read from the URL (?token=) or a manual prompt and kept in
// localStorage. The token is NOT baked into the served page.
const KEY = 'rc_token';

function readTokenFromUrl(): void {
    try {
        const url = new URL(window.location.href);
        const t = url.searchParams.get('token');
        if (t) {
            localStorage.setItem(KEY, t);
            url.searchParams.delete('token');
            window.history.replaceState({}, '', url.toString());
        }
    } catch { /* ignore */ }
}

export function getToken(): string | null {
    try { return localStorage.getItem(KEY); } catch { return null; }
}

readTokenFromUrl();

axios.interceptors.request.use((cfg) => {
    const t = getToken();
    if (t) {
        cfg.headers = cfg.headers || {};
        (cfg.headers as any).Authorization = `Bearer ${t}`;
    }
    return cfg;
});

let prompting = false;
axios.interceptors.response.use(
    (r) => r,
    (error) => {
        if (error?.response?.status === 401 && !prompting) {
            prompting = true;
            const entered = window.prompt('This RamsCraft instance requires an access token:');
            if (entered) {
                localStorage.setItem(KEY, entered);
                window.location.reload();
            }
            prompting = false;
        }
        return Promise.reject(error);
    }
);
