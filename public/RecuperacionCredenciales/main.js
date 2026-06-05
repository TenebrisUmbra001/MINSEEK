/**
 * Recuperación de Contraseña — Lógica del frontend
 * Se comunica con la API Pública (server.js) que proxya a la API Privada.
 */

const API_BASE = '';  // Relativo al mismo origen (server.js sirve esto)

// Estado global del flujo
let idUsuarioRecuperacion = null;
let correoRecuperacion = null;
let resendInterval = null;

// ── Referencias DOM ──
const emailInput       = document.getElementById('emailInput');
const emailMsg         = document.getElementById('emailMsg');
const btnSendCode      = document.getElementById('btnSendCode');

const codeInput        = document.getElementById('codeInput');
const newPassInput     = document.getElementById('newPassInput');
const confirmPassInput = document.getElementById('confirmPassInput');
const step2Msg         = document.getElementById('step2Msg');
const btnChangePass    = document.getElementById('btnChangePass');
const btnBack          = document.getElementById('btnBack');
const btnResend        = document.getElementById('btnResend');
const resendTimer      = document.getElementById('resendTimer');

const strengthFill     = document.getElementById('strengthFill');
const strengthText     = document.getElementById('strengthText');

// ── Utilidades ──

function mostrarMsg(el, texto, tipo) {
    el.textContent = texto;
    el.className = 'inline-msg ' + tipo;  // 'error' o 'success'
}

function limpiarMsg(el) {
    el.textContent = '';
    el.className = 'inline-msg';
}

function setLoading(btn, loading) {
    const txt = btn.querySelector('.btn-text');
    const spn = btn.querySelector('.btn-spinner');
    if (loading) {
        btn.disabled = true;
        if (txt) txt.style.visibility = 'hidden';
        if (spn) spn.classList.remove('hidden');
    } else {
        btn.disabled = false;
        if (txt) txt.style.visibility = 'visible';
        if (spn) spn.classList.add('hidden');
    }
}

function validarEmailZimbra(email) {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!regex.test(email)) return { valid: false, error: 'Formato de correo inválido' };
    if (!email.endsWith('@mail.das.pdr')) return { valid: false, error: 'El correo debe ser Zimbra (@mail.das.pdr)' };
    if (!/^[a-zA-Z0-9._-]+$/.test(email.split('@')[0])) return { valid: false, error: 'Caracteres inválidos en el correo' };
    return { valid: true };
}

function evaluarFortaleza(password) {
    if (!password) return { nivel: '', texto: '' };
    let score = 0;
    if (password.length >= 6) score++;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    if (score <= 1) return { nivel: 'weak', texto: 'Débil' };
    if (score === 2) return { nivel: 'fair', texto: 'Regular' };
    if (score === 3) return { nivel: 'good', texto: 'Buena' };
    return { nivel: 'strong', texto: 'Fuerte' };
}

function iniciarCountdown(segundos) {
    let restante = segundos;
    btnResend.disabled = true;
    resendTimer.textContent = `(${restante}s)`;

    if (resendInterval) clearInterval(resendInterval);

    resendInterval = setInterval(() => {
        restante--;
        if (restante <= 0) {
            clearInterval(resendInterval);
            resendInterval = null;
            btnResend.disabled = false;
            resendTimer.textContent = '';
        } else {
            resendTimer.textContent = `(${restante}s)`;
        }
    }, 1000);
}

// ── Navegación entre pasos ──

function goToStep(num) {
    // Ocultar todos los paneles
    document.querySelectorAll('.step-panel').forEach(p => p.classList.add('hidden'));

    // Mostrar panel correspondiente
    const panel = document.getElementById('panel' + num);
    if (panel) {
        panel.classList.remove('hidden');
        // Forzar re-animación
        panel.style.animation = 'none';
        panel.offsetHeight;  // reflow
        panel.style.animation = '';
    }

    // Actualizar indicadores
    for (let i = 1; i <= 3; i++) {
        const ind = document.getElementById('stepInd' + i);
        ind.classList.remove('active', 'completed');
        if (i < num) ind.classList.add('completed');
        else if (i === num) ind.classList.add('active');
    }

    // Actualizar líneas conectoras
    const line1 = document.getElementById('line1');
    const line2 = document.getElementById('line2');
    line1.classList.toggle('active', num >= 2);
    line2.classList.toggle('active', num >= 3);

    // Cambiar ícono de step completado (checkmark)
    for (let i = 1; i <= 3; i++) {
        const ind = document.getElementById('stepInd' + i);
        const numEl = ind.querySelector('.step-num');
        if (i < num) {
            numEl.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        } else {
            numEl.textContent = i;
        }
    }
}

// ── Toggle password ──

document.querySelectorAll('.toggle-pass').forEach(btn => {
    btn.addEventListener('click', function () {
        const targetId = this.getAttribute('data-target');
        const input = document.getElementById(targetId);
        const eyeOpen = this.querySelector('.ico-eye');
        const eyeOff = this.querySelector('.ico-eye-off');

        if (input.type === 'password') {
            input.type = 'text';
            eyeOpen.classList.add('hidden');
            eyeOff.classList.remove('hidden');
        } else {
            input.type = 'password';
            eyeOpen.classList.remove('hidden');
            eyeOff.classList.add('hidden');
        }
    });
});

// ── Fortaleza de contraseña en tiempo real ──

newPassInput.addEventListener('input', function () {
    const f = evaluarFortaleza(this.value);
    strengthFill.className = 'strength-fill ' + f.nivel;
    strengthText.className = 'strength-text ' + f.nivel;
    strengthText.textContent = f.texto;
});

// ── Solo números en el código ──

codeInput.addEventListener('input', function () {
    this.value = this.value.replace(/[^0-9]/g, '').slice(0, 6);
});

// ── Enter en el input de email ──

emailInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') enviarCodigo();
});

codeInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') cambiarPassword();
});

// ── PASO 1: Enviar código al correo ──

async function enviarCodigo() {
    limpiarMsg(emailMsg);
    emailInput.classList.remove('input-error', 'input-success');

    const correo = emailInput.value.trim();

    // Validación del formato de correo
    const validacion = validarEmailZimbra(correo);
    if (!validacion.valid) {
        mostrarMsg(emailMsg, validacion.error, 'error');
        emailInput.classList.add('input-error');
        emailInput.focus();
        return;
    }

    setLoading(btnSendCode, true);

    try {
        const resp = await fetch(API_BASE + '/api/recuperar-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correo: correo })
        });

        const data = await resp.json();

        if (data.exitoso) {
            correoRecuperacion = correo;
            idUsuarioRecuperacion = data.idUsuario || null;
            mostrarMsg(emailMsg, 'Código enviado a tu correo', 'success');
            emailInput.classList.add('input-success');

            // Avanzar al paso 2 después de un breve momento
            setTimeout(() => {
                goToStep(2);
                limpiarMsg(emailMsg);
                iniciarCountdown(60);
                codeInput.focus();
            }, 800);
        } else {
            mostrarMsg(emailMsg, data.error || 'No se pudo enviar el código', 'error');
            emailInput.classList.add('input-error');
        }
    } catch (err) {
        mostrarMsg(emailMsg, 'Error de conexión. Intenta de nuevo.', 'error');
    } finally {
        setLoading(btnSendCode, false);
    }
}

btnSendCode.addEventListener('click', enviarCodigo);

// ── Reenviar código ──

async function reenviarCodigo() {
    if (!correoRecuperacion) return;
    btnResend.disabled = true;
    limpiarMsg(step2Msg);

    try {
        const resp = await fetch(API_BASE + '/api/recuperar-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correo: correoRecuperacion })
        });

        const data = await resp.json();

        if (data.exitoso) {
            idUsuarioRecuperacion = data.idUsuario || idUsuarioRecuperacion;
            mostrarMsg(step2Msg, 'Nuevo código enviado', 'success');
            iniciarCountdown(60);
        } else {
            mostrarMsg(step2Msg, data.error || 'No se pudo reenviar', 'error');
            btnResend.disabled = false;
        }
    } catch (err) {
        mostrarMsg(step2Msg, 'Error de conexión', 'error');
        btnResend.disabled = false;
    }
}

btnResend.addEventListener('click', reenviarCodigo);

// ── Botón atrás ──

btnBack.addEventListener('click', function () {
    goToStep(1);
    limpiarMsg(step2Msg);
});

// ── PASO 2: Cambiar contraseña ──

async function cambiarPassword() {
    limpiarMsg(step2Msg);

    const codigo = codeInput.value.trim();
    const nuevaPass = newPassInput.value;
    const confirmPass = confirmPassInput.value;

    // Validaciones locales
    if (!codigo || codigo.length !== 6) {
        mostrarMsg(step2Msg, 'Ingresa el código de 6 dígitos', 'error');
        codeInput.classList.add('input-error');
        codeInput.focus();
        return;
    }
    codeInput.classList.remove('input-error');

    if (!nuevaPass || nuevaPass.length < 6) {
        mostrarMsg(step2Msg, 'La contraseña debe tener al menos 6 caracteres', 'error');
        newPassInput.classList.add('input-error');
        newPassInput.focus();
        return;
    }
    newPassInput.classList.remove('input-error');

    if (nuevaPass !== confirmPass) {
        mostrarMsg(step2Msg, 'Las contraseñas no coinciden', 'error');
        confirmPassInput.classList.add('input-error');
        confirmPassInput.focus();
        return;
    }
    confirmPassInput.classList.remove('input-error');

    if (!idUsuarioRecuperacion) {
        mostrarMsg(step2Msg, 'Sesión de recuperación inválida. Vuelve a ingresar tu correo.', 'error');
        return;
    }

    setLoading(btnChangePass, true);

    try {
        const resp = await fetch(API_BASE + '/api/restablecer-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                idUsuario: idUsuarioRecuperacion,
                codigo: codigo,
                nuevaContrasena: nuevaPass
            })
        });

        const data = await resp.json();

        if (data.exitoso) {
            goToStep(3);
            // Limpiar datos sensibles
            idUsuarioRecuperacion = null;
            correoRecuperacion = null;
        } else {
            mostrarMsg(step2Msg, data.error || 'No se pudo cambiar la contraseña', 'error');
        }
    } catch (err) {
        mostrarMsg(step2Msg, 'Error de conexión. Intenta de nuevo.', 'error');
    } finally {
        setLoading(btnChangePass, false);
    }
}

btnChangePass.addEventListener('click', cambiarPassword);