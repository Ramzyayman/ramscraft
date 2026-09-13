import { create } from 'zustand';
import axios from 'axios';
import { ServerStatus } from '@ramscraft/shared';

export interface Server {
    id: string;
    name: string;
    status: ServerStatus;
    minecraftVersion: string;
    software: string;
    port: number;
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
            const res = await axios.get('http://192.168.1.6:3001/api/servers');
            set({ servers: res.data });
        } catch (e) {
            console.error('Failed to fetch servers', e);
        }
    },
    updateServerStatus: (id, status) => set((state) => ({
        servers: state.servers.map(s => s.id === id ? { ...s, status } : s)
    }))
}));
