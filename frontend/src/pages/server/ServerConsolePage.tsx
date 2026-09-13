import React from 'react';
import { useParams } from 'react-router-dom';
import { Console } from '../../components/Console';

export const ServerConsolePage = () => {
    const { id } = useParams();
    
    if (!id) return null;
    
    return (
        <div className="w-full">
            <Console serverId={id} />
        </div>
    );
};
