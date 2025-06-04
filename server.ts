
import {requestStats} from "./types.ts";
import {
    handleMcRequest,
    status,
    getChangeLog,
    handleGithubWebhook,
    onStart,
    processPendingDeletions
} from "./api_functions.ts";

const servePort: number = 3000;
const servIP: string = "0.0.0.0";
onStart();

Deno.serve({port: servePort, hostname: servIP}, (request: Request) => {
    const ip: string = request.headers.get("host") || "";
    const pathName = new URL(request.url).pathname;
    const thisReq: requestStats = {
        "ip": ip,
        "begTs": Date.now(),
        "reqType": request.method,
        "endPoint": pathName,
        "endTs": Date.now(),
        "reqCount": 0
    };
    if (request.method == "POST") {
        switch (pathName) {
            case "/mc_api":
                return handleMcRequest(request, thisReq);
            case "/github-webhook":
                console.log(thisReq);
                return handleGithubWebhook(request);
            default:
                return new Response("Unknown post route", {status: 501});
        }
    } else if (request.method === "GET") {
        switch (pathName) {
            case "/status":
                console.log(thisReq);
                return new Response(status(),                                   {"status": 200});
            case "/changelog":
                return getChangeLog(thisReq);
            case "/info":
                console.log(thisReq);
                return new Response("https://github.com/cafread/metrocity_api", {"status": 200});
            case "/version":
                console.log(thisReq);
                return new Response("Release candidate 1.5",                    {"status": 200});
            default:
                console.log(thisReq);
                console.warn("Unknown GET route requested:", pathName);
                return new Response("Unknown GET route",                        {"status": 501});
        }
    } else {
        console.log(thisReq);
        return new Response("Request type not accepted", {status: 405});
    }
});

Deno.cron("Deletions and KV miss check", {hour: {every: 48}}, () => {
    // Occasionally check for missed scheduled deletions, not relying on onStart to find them
    processPendingDeletions().catch((err) => console.error("Error in periodic deletion handler:", err));
});
