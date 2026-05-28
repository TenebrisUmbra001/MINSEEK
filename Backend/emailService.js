// Backend/emailService.js
const nodemailer = require('nodemailer');

// ⚠️ CONFIGURA ESTO CON TUS DATOS DE ZIMBRA
// Backend/emailService.js
const nodemailer = require('nodemailer');

// ⚠️ CONFIGURA AQUÍ TUS DATOS REALES DE ZIMBRA
const ZIMBRA_CONFIG = {
    host: 'mail.das.pdr', // Si tu servidor tiene otra IP o subdominio, cámbialo aquí (ej: '192.168.1.100')
    port: 465,            // 465 para SSL. Si Zimbra usa STARTTLS, cambia a 587 y secure: false
    secure: true,         
    auth: {
        // 👇 PON AQUÍ UN CORREO REAL QUE EXISTA EN TU SERVIDOR ZIMBRA 👇
        user: 'iaccr@mail.das.pdr', 
        // 👇 PON AQUÍ LA CONTRASEÑA DE ESE CORREO 👇
        pass: 'D.2026/*' 
    }
};

const transporter = nodemailer.createTransport(ZIMBRA_CONFIG);

/**
 * Envía un correo con el código de validación
 * @param {string} correoDestino - El correo del usuario registrado
 * @param {string} codigo - El código de 8 dígitos
 */
async function enviarCodigoVerificacion(correoDestino, codigo) {
    try {
        const mailOptions = {
            from: `"IACCR DEVTEAM" <${ZIMBRA_CONFIG.auth.user}>`, // Nombre que aparece como remitente
            to: correoDestino,
            subject: 'Código de Verificación - CHATBOT con IACCR',
            text: `Gracias por usar nuestro servicio de CHATBOT con IACCR. Tu código de verificación de la cuenta es: ${codigo}. Expira en 10 minutos. Si no solicitaste esto, ignora este correo.`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px; max-width: 500px; margin: auto; background-color: #f9f9f9;">
                    <div style="background-color: #2ecc71; padding: 10px; border-radius: 8px 8px 0 0; text-align: center;">
                        <h2 style="color: white; margin: 0;">CHATBOT con IACCR</h2>
                    </div>
                    <div style="padding: 20px; background-color: white; border-radius: 0 0 8px 8px;">
                        <p style="font-size: 16px; color: #333;">Hola,</p>
                        <p style="font-size: 16px; color: #333;">Gracias por usar nuestro servicio. Para completar tu registro, utiliza el siguiente código de verificación:</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <span style="font-size: 32px; font-weight: bold; color: #2ecc71; background: #e8f8f0; padding: 15px 30px; border-radius: 8px; letter-spacing: 8px; border: 2px dashed #2ecc71;">${codigo}</span>
                        </div>
                        <p style="color: #888; font-size: 14px; text-align: center;">⏳ Este código expira en <strong>10 minutos</strong>.</p>
                        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                        <p style="color: #999; font-size: 12px; text-align: center;">Si no solicitaste este registro, por favor ignora este correo.</p>
                    </div>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('📧 Correo enviado exitosamente: %s', info.messageId);
        return { exitoso: true };
    } catch (error) {
        console.error('❌ Error enviando correo por Zimbra:', error.message);
        return { exitoso: false, error: error.message };
    }
}

module.exports = { enviarCodigoVerificacion };