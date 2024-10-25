export type xy        = [number, number];
export type strInt    = number | string;
export type rawDatum  = {"id": strInt, "lat": number, "lon": number, "cc"?: string};
export type rawData   = rawDatum[];
export type targ      = {"id": strInt, "x": number, "y": number, "cc": string};
export type targArr   = {"id": strInt, "x": number, "y": number, "cc": string}[];
export type res       = {"id": strInt, "mc": string};
export type resArr    = res[];
export type resArrArr = resArr[];
export type retObj    = {[index: string]:string};
export type latLon    = {"lat": number, "lon": number};
export type reqStat = {id: string, begTs: number, endTs: number, reqType: string, endPoint: string, reqCount: number};