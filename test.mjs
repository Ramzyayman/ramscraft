import axios from "axios";
import fs from "fs";

const API = "http://127.0.0.1:3001/api";

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function runTests() {
    try {
        console.log("1. Creating server...");
        const srvRes = await axios.post(`${API}/servers`, {
            name: "TestServer",
            port: 25565,
            minRamMb: 1024,
            maxRamMb: 2048
        });
        const id = srvRes.data.id;
        console.log("Server created:", id);

        console.log("2. Verifying Connection Information logic...");
        const updateRes = await axios.patch(`${API}/servers/${id}`, {
            name: "TestServer",
            port: 25565,
            minRamMb: 1024,
            maxRamMb: 2048,
            publicAddress: "mc.test.com"
        });
        if (updateRes.data.publicAddress !== "mc.test.com") {
            throw new Error("Public address was not saved properly via PATCH!");
        }

        console.log("3. Installing software (Vanilla 1.20.4)...");
        await axios.post(`${API}/servers/${id}/software/install`, {
            providerId: "vanilla",
            mcVersion: "1.20.4",
            releaseId: "1.20.4"
        });
        console.log("Software installed.");

        console.log("4. Accepting EULA...");
        await axios.post(`${API}/servers/${id}/lifecycle/eula`, { accept: true });
        
        console.log("5. Generating new world (Safe Mode)...");
        const genRes = await axios.post(`${API}/servers/${id}/worlds/generate`, {
            worldName: "my_new_world"
        });
        if (!genRes.data.success) throw new Error("World generation API failed");
        
        // Let's create a fake world directory to test rename
        fs.mkdirSync(`/home/ramzy/ramscraft/servers/${srvRes.data.directoryName}/my_new_world`, { recursive: true });
        fs.writeFileSync(`/home/ramzy/ramscraft/servers/${srvRes.data.directoryName}/my_new_world/level.dat`, "fake");
        
        const genRes2 = await axios.post(`${API}/servers/${id}/worlds/generate`, {
            worldName: "my_new_world"
        });
        if (!genRes2.data.backupCreated) throw new Error("World backup was not created!");
        console.log("World safe-gen logic verified.");

        console.log("6. Testing backup cycle...");
        await axios.post(`${API}/servers/${id}/backups`);
        console.log("Backup requested.");
        
        await sleep(3000);
        const backups = await axios.get(`${API}/servers/${id}/backups`);
        if (backups.data.length === 0) throw new Error("Backup was not created");
        console.log("Backup found:", backups.data[0].name);
        
        console.log("8. Cleaning up...");
        await axios.delete(`${API}/servers/${id}`);
        
        console.log("ALL V1.1 E2E TESTS PASSED!");
    } catch (e) {
        console.error("Test failed:", e.response?.data || e.message);
        process.exit(1);
    }
}

runTests();
