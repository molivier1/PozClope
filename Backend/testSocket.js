import 'dotenv/config';
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ensureAccessToken, TEAM_ID } = require('./includes.js');

const API_URL = 'http://37.187.156.222:8080';

async function startSocket() {
    try {
        const token = await ensureAccessToken();

        const client = new Client({
            webSocketFactory: () => new SockJS(`${API_URL}/stomp`, null, {
                headers: { 'Origin': 'http://localhost:4200' }
            }),
            connectHeaders: { Authorization: `Bearer ${token}` },
            reconnectDelay: 5000,
            // On enlève la ligne debug pour ne plus voir les <<< MESSAGE et data
        });

        client.onConnect = () => {
            console.log('📡 RADAR ACTIF - Écoute des secteurs en cours...\n');

            // Canal Global (Conquêtes, alertes générales)
            client.subscribe('/events/global', (msg) => {
                const data = JSON.parse(msg.body);
                console.log(`🌍 [GLOBAL] ${data.heure} | ${data.message}`);
            });

            // Canal Équipe (Tes attaques, tes mouvements)
            if (TEAM_ID) {
                client.subscribe(`/events/teams/${TEAM_ID}`, (msg) => {
                    const data = JSON.parse(msg.body);
                    console.log(`🛡️ [TEAM]   ${data.heure} | ${data.message}`);
                });
            }
        };

        client.onStompError = (frame) => console.error('❌ Erreur STOMP :', frame.headers['message']);
        client.onWebSocketClose = () => console.log('⚠️ Connexion radar interrompue.');

        client.activate();

    } catch (err) {
        console.error("💥 Erreur :", err.message);
    }
}

startSocket();