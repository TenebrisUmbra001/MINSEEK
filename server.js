// server.js
const express = require('express');
const path = require('path');

const app = express();
const PORT = 2054;

const fetchFn = global.fetch ? global.fetch.bind(global) : undefined;

// Servir archivos estáticos desde la carpeta public
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Si quieres que la raíz cargue el login directamente:

app.get('/', (req, res) => {
    const rutaArchivo = path.join(__dirname, 'public', 'InicioSesion', 'index.html');


    res.sendFile(rutaArchivo, (err) => {
        if (err) {


        } else {

        }
    });
});




// Ruta del proxy hacia Ollama (streaming)
app.post('/api/chat', async (req, res) => {
    const { messages } = req.body;

    try {
        // Llamada a la API de Ollama con stream: true
        if (!fetchFn) {
            throw new Error('fetch no está disponible en esta versión de Node. Actualiza a Node 18+ o instala un polyfill.');
        }

        const response = await fetchFn('http://localhost:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'deepseek-r1:14b',   // Ajusta el nombre exacto de tu modelo
                messages: messages,
                stream: true
            })
        });

        if (!response.ok) {
            const serverText = await response.text();
            throw new Error(serverText || `Ollama respondió con estado ${response.status}`);
        }

        // Transmitir la respuesta al cliente como Server-Sent Events
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            // Procesar líneas individuales (cada línea es un JSON)
            const lines = buffer.split('\n');
            buffer = lines.pop(); // guardar la línea incompleta

            for (const line of lines) {
                if (line.trim() === '') continue;
                try {
                    const chunk = JSON.parse(line);
                    // Enviar solo el contenido generado
                    if (chunk.message && chunk.message.content) {
                        res.write(`data: ${JSON.stringify({ content: chunk.message.content })}\n\n`);
                    }
                    // Si termina, enviar evento final (opcional)
                    if (chunk.done) {
                        res.write(`data: [DONE]\n\n`);
                    }
                } catch (e) {
                    console.error('Parse error:', e);
                }
            }
        }
        res.end();
    } catch (error) {
        console.error('Error al comunicar con Ollama:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Servidor de chat corriendo en http://localhost:${PORT}`);
});