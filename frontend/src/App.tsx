import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { GlobalLayout } from './layouts/GlobalLayout';
import { Dashboard } from './pages/Dashboard';
import { CreateServerWizard } from './pages/CreateServerWizard';
import { ServerOverview } from './pages/server/ServerOverview';
import { ServerConsolePage } from './pages/server/ServerConsolePage';
import { ServerLayout } from './layouts/ServerLayout';
import { Settings } from './pages/server/Settings';
import { Players } from './pages/server/Players';
import { Files } from './pages/server/Files';
import { Backups } from './pages/server/Backups';
import { Worlds } from './pages/server/Worlds';
import { Software } from './pages/server/Software';
import { io } from 'socket.io-client';
import { useServersStore } from './store/useServersStore';

export const socket = io({ autoConnect: false });

function App() {
    const updateServerStatus = useServersStore(s => s.updateServerStatus);

    useEffect(() => {
        socket.connect();
        
        socket.on('serverStatus', (data: { serverId: string, status: any }) => {
            updateServerStatus(data.serverId, data.status);
        });

        return () => {
            socket.disconnect();
        };
    }, []);

    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<GlobalLayout />}>
                    <Route index element={<Dashboard />} />
                    <Route path="create" element={<CreateServerWizard />} />
                    
                    <Route path="server/:id" element={<ServerLayout />}>
                        <Route index element={<Navigate to="overview" replace />} />
                        <Route path="overview" element={<ServerOverview />} />
                        <Route path="console" element={<ServerConsolePage />} />
                        <Route path="settings" element={<Settings />} />
                        <Route path="players" element={<Players />} />
                        <Route path="software" element={<Software />} />
                        <Route path="files" element={<Files />} />
                        <Route path="worlds" element={<Worlds />} />
                        <Route path="backups" element={<Backups />} />
                    </Route>
                </Route>
            </Routes>
        </BrowserRouter>
    );
}

export default App;
