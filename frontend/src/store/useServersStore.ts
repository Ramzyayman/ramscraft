import { create } from 'zustand';
import axios from 'axios';
import { ServerStatus } from '@ramscraft/shared';

export interface ServerSoftware {
    provider: string;
    mcVersion: string;
    releaseId: string;
}

export interface Server {
    id: string;
    name: string;
    status: ServerStatus;
    software?: ServerSoftware | null;
    javaRuntimeId?: string | null;
    javaRuntime?: { id: string; name: string; majorVersion: number; path: string } | null;
    port: number;
    publicAddress?: string;
    minRamMb: number;
    maxRamMb: number;
}

interface ServersState {
    servers: Server[];
    fetchServers: () => Promise<void>;
    updateServerStatus: (id: string, status: ServerStatus) => void;
}

export const useServersStore = create<ServersState>((set) => ({
    servers: [],
    fetchServers: async () => {
        try {
            const res = await axios.get('/api/servers');
            set({ servers: res.data });
        } catch (e) {
            console.error('Failed to fetch servers', e);
        }
    },
    updateServerStatus: (id, status) => set((state) => ({
        servers: state.servers.map(s => s.id === id ? { ...s, status } : s)
    }))
}));
