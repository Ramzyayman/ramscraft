import { ISoftwareProvider } from './ISoftwareProvider';
import { VanillaProvider, SnapshotProvider } from './VanillaProvider';
import { PaperProvider } from './PaperProvider';
import { SpigotProvider } from './SpigotProvider';
import { PurpurProvider } from './PurpurProvider';
import { FabricProvider } from './FabricProvider';
import { QuiltProvider } from './QuiltProvider';
import { NeoForgeProvider } from './NeoForgeProvider';
import { ForgeProvider } from './ForgeProvider';
import { ModpackProvider } from './ModpackProvider';
import { ArclightProvider } from './ArclightProvider';

export class ProviderRegistry {
    private providers: Map<string, ISoftwareProvider> = new Map();

    constructor() {
        this.register(new VanillaProvider());
        this.register(new SnapshotProvider());
        this.register(new PaperProvider());
        this.register(new SpigotProvider());
        this.register(new PurpurProvider());
        this.register(new FabricProvider());
        this.register(new QuiltProvider());
        this.register(new NeoForgeProvider());
        this.register(new ForgeProvider());
        this.register(new ModpackProvider());
        this.register(new ArclightProvider());
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
