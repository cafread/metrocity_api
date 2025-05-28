export type strInt           = number | string;
export type tileCache        = {idMap: number[], datStr: string, cachedAt?: number};
export type rawCity          = {"i": number, "p": number, "n": string, "la": number, "lo": number};
export type cities           = {[index: number]: {"p": number, "n": string, "la": number, "lo": number}};
export type rawInput         = {"id": strInt, "lat": number, "lon": number, "cc"?: string};
export type processedInput   = {"id": strInt, "x": number, "y": number, "cc": string};
export type geoPoint         = {"lat": number, "lon": number};
export type baseResult       = {"id": strInt, "mc": string};
export type resultMap        = Record<string, string>;
export type changeLog        = Record<strInt, number>;
export type requestStats     = {ip: string, begTs: number, endTs: number, reqType: string, endPoint: string, reqCount: number};
export type PendingDeletions = {
    tileKeys: string[]; // e.g. ["106_052", "107_052"]
    notBefore: number;  // Unix timestamp (ms) after which deletion can occur
    createdAt: number;  // Optional: time the record was written, useful for debugging
    reason?: string;    // Optional: description like "webhook commit abc123"
};