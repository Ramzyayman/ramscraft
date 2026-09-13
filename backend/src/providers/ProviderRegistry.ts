import { ISoftwareProvider } from './ISoftwareProvider';
import { VanillaProvider } from './VanillaProvider';
import { PaperProvider } from './PaperProvider';

export class ProviderRegistry {
    private providers: Map<string, ISoftwareProvider> = new Map();

    constructor() {
        this.register(new VanillaProvider());
        this.register(new PaperProvider());
    }

    public register(provider: ISoftwareProvider) {
        this.providers.set(provider.id, provider);
    }

    public get(id: string): ISoftwareProvider {
        const provider = this.providers.get(id);
        if (!provider) throw new Error(`Provider ${id} not found`);
        return provider;
    }

    public getAll(): ISoftwareProvider[] {
        return Array.from(this.providers.values());
    }
}

export const providerRegistry = new ProviderRegistry();
