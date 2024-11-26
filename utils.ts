export async function loadRemoteJSON<T> (url: string): Promise<T> {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch JSON: ${response.statusText}`);
        return await response.json();
    } catch (error) {
        console.error(`Error fetching JSON from ${url}:`, error);
        throw error; // Rethrow error so callers can handle it
    }
}
export function lpad (str: string, len: number, padChar: string="0"): string {
    const retLen = Math.max(str.length, len);
    return padChar.repeat(retLen - str.length) + str;
}

export function isValidTileKey (str: string): boolean {
    const regex = /^[0-9]{3}_[0-9]{3}$/;
    return regex.test(str);
}