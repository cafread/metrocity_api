
import {reqStat} from "./types.ts";
import {handleMcRequest, status, getChangeLog, handleGithubWebhook, onStart} from "./api_functions.ts";

const servePort: number = 3000;
const servIP: string = "0.0.0.0";
onStart();

Deno.serve({port: servePort, hostname: servIP}, (request: Request) => {
    const ip: string = request.headers.get("host") || "";
    const pathName = new URL(request.url).pathname;
    const thisReq: reqStat = {
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
                return handleMcRequest (request, thisReq);
            case "/github-webhook":
                console.log(thisReq);
                return handleGithubWebhook(request);
            default:
                return new Response("Unknown post route", {status: 501});
        }
    } else if (request.method === "GET") {
        console.log(thisReq);
        switch (pathName) {
            case "/status":
                return new Response(status(),                                   {"status": 200});
            case "/changelog":
                return getChangeLog();
            case "/info":
                return new Response("https://github.com/cafread/metrocity_api", {"status": 200});
            case "/version":
                return new Response("Release candidate 1.5",                    {"status": 200});
            default:
                console.warn("Unknown GET route requested:", pathName);
                return new Response("Unknown GET route",                        {"status": 501});
        }
    } else {
        return new Response("Request type not accepted", {status: 405});
    }
});
