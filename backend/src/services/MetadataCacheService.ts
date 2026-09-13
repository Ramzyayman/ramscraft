import { prisma } from '../index';

export class MetadataCacheService {
    // Fallback-enabled caching mechanism
    public async getCachedOrFetch<T>(
        provider: string, 
        key: string, 
        ttlMs: number, 
        fetcher: () => Promise<T>
    ): Promise<T> {
        const record = await prisma.metadataCache.findUnique({
            where: {
                provider_key: { provider, key }
            }
        });

        // 1. Return fresh cache
        if (record && (Date.now() - record.updatedAt.getTime() < ttlMs)) {
            return JSON.parse(record.payload) as T;
        }

        // 2. Fetch new data
        try {
            const data = await fetcher();
            await prisma.metadataCache.upsert({
                where: { provider_key: { provider, key } },
                update: { payload: JSON.stringify(data), updatedAt: new Date() },
                create: { provider, key, payload: JSON.stringify(data) }
            });
            return data;
        } catch (error) {
            // 3. Fallback to stale cache if API fails (offline mode)
            if (record) {
                console.warn(`API request failed for ${provider}:${key}. Using stale cache fallback.`);
                return JSON.parse(record.payload) as T;
            }
            throw new Error(`Failed to fetch ${provider}:${key} and no cache exists: ${error}`);
        }
    }
}

export const cacheService = new MetadataCacheService();
