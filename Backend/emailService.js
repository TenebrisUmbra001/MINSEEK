// Backend/emailService.js
const nodemailer = require('nodemailer');

const ZIMBRA_CONFIG = {
    host: 'mail.das.pdr',
    port: 465,
    secure: true,
    auth: {
        user: 'no-reply@das.pdr',
        pass: 'tu_contraseña_aqui'
    },
    tls: {
        rejectUnauthorized: false
    },
    // ✅ NUEVO: Forzar a Nodemailer a darnos logs detallados de la conversación SMTP
    logger: true,
    debug: true
};

console.log('📧 [EMAIL] Creando transportador de correo Zimbra...');
const transporter = nodemailer.createTransport(ZIMBRA_CONFIG);

// ✅ NUEVO: Escuchar eventos críticos de la conexión
transporter.on('error', (err) => {
    console.error('❌ [EMAIL-TRANSPORT] Error general en el transportador:', err.message);
});

transporter.on('secureConnect', () => {
    console.log('✅ [EMAIL-TRANSPORT] Conexión TLS segura establecida con Zimbra.');
});

// ✅ NUEVO: Verificar conexión al arrancar el servidor (No espera a que un usuario se registre)
transporter.verify(function (error, success) {
    if (error) {
        console.error('❌ [EMAIL-INIT] FALLO AL VERIFICAR CONEXIÓN CON ZIMBRA AL INICIAR:');
        console.error(error);
    } else {
        console.log('✅ [EMAIL-INIT] Servidor Zimbra listo para enviar correos. Estado:', success);
    }
});

async function enviarCodigoVerificacion(correoDestino, codigo) {
    console.log(`📧 [EMAIL] Iniciando proceso de envío a: ${correoDestino}`);

    try {
        const mailOptions = {
            from: `"CCRDEV TEAM" <${ZIMBRA_CONFIG.auth.user}>`,
            to: correoDestino,
            subject: 'Código de Verificación para la cuenta del  - CHATBOT con IACCR',
            text: `Gracias por usar nuestro servicio de IACCR cualquier problema no dude en contactarnos al Centro de Datos Del ORGANO DE ICC . Su código de verificación de la cuenta es: ${codigo}. Expira en 10 minutos.`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px; max-width: 500px; margin: auto; background-color: #f9f9f9;">
                    <div style="background-color: #2ecc71; padding: 10px; border-radius: 8px 8px 0 0; text-align: center;">
                        <h2 style="color: white; margin: 0;">CHATBOT con IACCR</h2>
                    </div>
                    <div style="padding: 20px; background-color: white; border-radius: 0 0 8px 8px;">
                        <p style="font-size: 16px; color: #333;">Hola,</p>
                        <p style="font-size: 16px; color: #333;">Para completar tu registro, utiliza el siguiente código:</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <span style="font-size: 32px; font-weight: bold; color: #2ecc71; background: #e8f8f0; padding: 15px 30px; border-radius: 8px; letter-spacing: 8px; border: 2px dashed #2ecc71;">${codigo}</span>
                        </div>
                        <p style="color: #888; font-size: 14px; text-align: center;">⏳ Este código expira en <strong>10 minutos</strong>.</p>
                        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                        <p style="color: #999; font-size: 12px; text-align: center;">Si no solicitaste este registro, ignora este correo.</p>
                    </div>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);

        console.log('✅ [EMAIL] Correo aceptado por Zimbra para entrega.');
        console.log(`   -> Message ID: ${info.messageId}`);
        console.log(`   -> Respuesta del servidor: ${info.response}`);

        return { exitoso: true };

    } catch (error) {
        console.error('❌ [EMAIL] ERROR ENVIANDO CORREO:');
        console.error(`   -> Destino: ${correoDestino}`);
        console.error(`   -> Código de error Nodemailer: ${error.code || 'Desconocido'}`);
        console.error(`   -> Comando SMTP fallido: ${error.command || 'N/A'}`);
        console.error(`   -> Mensaje: ${error.message}`);

        return { exitoso: false, error: error.message, code: error.code };
    }
}


/**
 * Envía un correo con el código de recuperación de contraseña.
 * Usa un diseño diferenciado (naranja) para distinguirlo del correo de registro.
 */
async function enviarCodigoRecuperacion(correoDestino, codigo) {
    console.log(`📧 [RECOVERY] Iniciando envío de código de recuperación a: ${correoDestino}`);

    try {
        const mailOptions = {
            from: `"CCRDEV TEAM" <${ZIMBRA_CONFIG.auth.user}>`,
            to: correoDestino,
            subject: 'Código de Recuperación de Contraseña - CHATBOT con IACCR',
            text: `Has solicitado restablecer tu contraseña. Tu código de recuperación es: ${codigo}. Expira en 10 minutos. Si no solicitaste este cambio, ignora este correo.`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px; max-width: 500px; margin: auto; background-color: #f9f9f9;">
                    <div style="background-color: #d35400; padding: 10px; border-radius: 8px 8px 0 0; text-align: center;">
                        <h2 style="color: white; margin: 0;">CHATBOT con IACCR</h2>
                    </div>
                    <div style="padding: 20px; background-color: white; border-radius: 0 0 8px 8px;">
                        <p style="font-size: 16px; color: #333;">Hola,</p>
                        <p style="font-size: 16px; color: #333;">Has solicitado restablecer tu contraseña. Utiliza el siguiente código:</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <span style="font-size: 32px; font-weight: bold; color: #d35400; background: #fef5ec; padding: 15px 30px; border-radius: 8px; letter-spacing: 8px; border: 2px dashed #d35400;">${codigo}</span>
                        </div>
                        <p style="color: #888; font-size: 14px; text-align: center;">⏳ Este código expira en <strong>10 minutos</strong>.</p>
                        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                        <p style="color: #999; font-size: 12px; text-align: center;">Si no solicitaste este cambio, ignora este correo y tu contraseña permanecerá sin cambios.</p>
                    </div>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);

        console.log('✅ [RECOVERY] Correo de recuperación aceptado por Zimbra.');
        console.log(`   -> Message ID: ${info.messageId}`);
        console.log(`   -> Respuesta del servidor: ${info.response}`);

        return { exitoso: true };

    } catch (error) {
        console.error('❌ [RECOVERY] ERROR ENVIANDO CORREO DE RECUPERACIÓN:');
        console.error(`   -> Destino: ${correoDestino}`);
        console.error(`   -> Código de error Nodemailer: ${error.code || 'Desconocido'}`);
        console.error(`   -> Mensaje: ${error.message}`);

        return { exitoso: false, error: error.message, code: error.code };
    }
}

// ── Exportar ambas funciones ──
module.exports = { enviarCodigoVerificacion, enviarCodigoRecuperacion };

