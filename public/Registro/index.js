/* ========================================
   Toggle mostrar/ocultar contraseña
======================================== */
var botones = document.querySelectorAll('.toggle-password');
for (var i = 0; i < botones.length; i++) {
    botones[i].addEventListener('click', function () {
        var targetId = this.getAttribute('data-target');
        var input = document.getElementById(targetId);
        var eyeOpen = this.querySelector('.eye-open');
        var eyeClosed = this.querySelector('.eye-closed');

        if (input.type === 'password') {
            input.type = 'text';
            eyeOpen.style.display = 'none';
            eyeClosed.style.display = 'block';
            this.setAttribute('aria-label', 'Ocultar contraseña');
        } else {
            input.type = 'password';
            eyeOpen.style.display = 'block';
            eyeClosed.style.display = 'none';
            this.setAttribute('aria-label', 'Mostrar contraseña');
        }
    });
}

/* ========================================
   Lógica del Modal, Timer y Intentos
======================================== */
var timerModal = null;
var timerInterval = null;
var tiempoRestanteSegundos = 600; // 10 minutos en segundos

function iniciarTimerModal() {
    if (timerModal) clearTimeout(timerModal);
    if (timerInterval) clearInterval(timerInterval);

    tiempoRestanteSegundos = 600;

    timerInterval = setInterval(function() {
        tiempoRestanteSegundos--;
        
        var minutos = Math.floor(tiempoRestanteSegundos / 60);
        var segundos = tiempoRestanteSegundos % 60;
        
        document.getElementById('timerModalTexto').textContent = 
            'Tiempo restante: ' + minutos + ':' + (segundos < 10 ? '0' : '') + segundos;

        if (tiempoRestanteSegundos <= 0) {
            CerrarModal(true);
        }
    }, 1000);
}

function MostrarModalCodigo() {
    var modal = document.getElementById('modalCodigo');
    var inputCodigo = document.getElementById('Codigo');
    var btnValidar = document.getElementById('btnValidarCodigo');
    var intentosTexto = document.getElementById('intentosModal');
    
    inputCodigo.value = ''; 
    inputCodigo.disabled = false;
    btnValidar.disabled = false;
    
    intentosTexto.textContent = 'Intentos restantes: 5';
    intentosTexto.style.color = '#2ecc71';
    
    modal.classList.add('active');
    iniciarTimerModal();
}

function CerrarModal(porTimeout) {
    var modal = document.getElementById('modalCodigo');
    modal.classList.remove('active');
    
    if (timerModal) { clearTimeout(timerModal); timerModal = null; }
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

    if (porTimeout) {
        alert("La ventana de validación se cerró por inactividad. Debe intentar registrarse nuevamente.");
        sessionStorage.removeItem('idUsuarioRegistro');
    }
}

/* ============================================================================
   PASO 1: REGISTRO COMPLETO - Enviar datos a la API
============================================================================ */

function RegistroCuenta() {
    // ✅ Reemplazo de optional chaining (?.) por validaciones clásicas
    var usuarioEl = document.getElementById("Usuario");
    var correoEl = document.getElementById("Correo");
    var contraseñaEl = document.getElementById("Contraseña");
    var confirmarEl = document.getElementById("ConfirmarContraseña");

    var usuario = usuarioEl ? usuarioEl.value.trim() : "";
    var correo = correoEl ? correoEl.value.trim() : "";
    var contraseña = contraseñaEl ? contraseñaEl.value : "";
    var confirmar = confirmarEl ? confirmarEl.value : "";

    if (!usuario || !correo || !contraseña || !confirmar) {
        alert("Por favor, complete todos los campos.");
        return;
    }

    // Validar dominio del correo
    var dominioCorrecto = "mail.das.pdr";
    var partes = correo.split("@");
    
    if (partes.length !== 2) {
        alert("El formato del correo es incorrecto.");
        return;
    }

    var usuarioCorreo = partes[0];
    var dominioIngresado = partes[1];

    if (dominioIngresado !== dominioCorrecto) {
        alert("El correo debe terminar en @" + dominioCorrecto);
        return;
    }

    var regexCorreo = /^[a-zA-Z0-9._-]+$/;
    if (!regexCorreo.test(usuarioCorreo)) {
        alert("El correo contiene caracteres inválidos.");
        return;
    }

    if (contraseña !== confirmar) {
        alert("Las contraseñas no coinciden.");
        return;
    }

    if (contraseña.length < 8) {
        alert("La contraseña debe tener al menos 8 caracteres");
        return;
    }

    if (usuario.length < 3 || usuario.length > 50) {
        alert("El usuario debe tener entre 3 y 50 caracteres");
        return;
    }

    // Mostrar loader
    var btnRegistrar = document.querySelector('.btn-register');
    var spanTexto = btnRegistrar.querySelector('span');
    var textoOriginal = spanTexto.textContent;
    
    btnRegistrar.disabled = true;
    spanTexto.textContent = 'Registrando...';

    // ✅ Reemplazo de .finally() por función auxiliar
    function restaurarBoton() {
        btnRegistrar.disabled = false;
        spanTexto.textContent = textoOriginal;
    }

    // 1. Enviar solicitud de registro a la API
    fetch('/api/registro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: usuario, correo: correo, contrasena: contraseña })
    })
    .then(function(response) { return response.json(); })
    .then(function(data) {
        if (!data.exitoso) {
            alert('Error: ' + (data.error || 'No se pudo registrar'));
            restaurarBoton();
            return; // Detener la cadena
        }

        var idUsuario = data.idUsuario;
        console.log('✅ Usuario registrado con ID:', idUsuario);

        // 2. Generar código de validación
        spanTexto.textContent = 'Generando código...';

        fetch('/api/generar-codigo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idUsuario: idUsuario })
        })
        .then(function(respCodigo) { return respCodigo.json(); })
        .then(function(dataCodigo) {
            if (!dataCodigo.exitoso) {
                alert('Error generando código: ' + (dataCodigo.error || 'Intente de nuevo'));
                restaurarBoton();
                return;
            }

            console.log('📧 Código generado (dev mode):', dataCodigo.codigo);

            // 3. Guardar idUsuario en sessionStorage
            sessionStorage.setItem('idUsuarioRegistro', idUsuario);

            // 4. Mostrar modal para ingreso de código
            MostrarModalCodigo();
            restaurarBoton();
        })
        .catch(function(errorCodigo) {
            console.error('Error generando código:', errorCodigo);
            alert('Error al generar el código. Intenta más tarde.');
            restaurarBoton();
        });

    })
    .catch(function(error) {
        console.error('Error en registro:', error);
        alert('Error al conectar con el servidor. Intenta más tarde.');
        restaurarBoton();
    });
}

/* ========================================
   PASO 2: VALIDAR CÓDIGO INGRESADO
======================================== */

function ValidarCodigo() {
    var codigo = document.getElementById("Codigo").value.trim();
    var intentosTexto = document.getElementById('intentosModal');
    var inputCodigo = document.getElementById("Codigo");
    var btnValidar = document.getElementById('btnValidarCodigo');
    var idUsuario = sessionStorage.getItem('idUsuarioRegistro');

    if (!codigo) {
        alert("Por favor, ingrese el código de seguridad.");
        return;
    }

    if (codigo.length !== 8 || !/^\d+$/.test(codigo)) {
        alert("El código debe tener exactamente 8 dígitos numéricos.");
        return;
    }

    if (!idUsuario) {
        alert("Error de sesión: No se encontró tu ID de usuario. Por favor, cierra este modal e intenta registrarte de nuevo.");
        return;
    }

    btnValidar.disabled = true;
    btnValidar.textContent = 'Validando...';

    // ✅ Reemplazo de .finally()
    function restaurarBoton() {
        if (!btnValidar.disabled) { // Solo restaurar si no está bloqueado por intentos
            btnValidar.disabled = false;
            btnValidar.textContent = 'Validar Código';
        }
    }

    fetch('/api/validar-codigo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            idUsuario: idUsuario,
            codigo: codigo
        })
    })
    .then(function(response) { return response.json(); })
    .then(function(data) {
        if (data.exitoso) {
            CerrarModal(false);
            alert('✅ ' + data.mensaje + '\n\nAhora puedes iniciar sesión.');
            
            // Limpiar formulario y sesión
            document.getElementById("Usuario").value = '';
            document.getElementById("Correo").value = '';
            document.getElementById("Contraseña").value = '';
            document.getElementById("ConfirmarContraseña").value = '';
            sessionStorage.removeItem('idUsuarioRegistro');
            
            // Redirigir a login (reemplazo de arrow function)
            setTimeout(function() {
                window.location.href = '../InicioSesion/index.html';
            }, 2000);
        } else {
            // Código inválido
            intentosTexto.style.color = '#e74c3c';
            
            if (data.intentosRestantes !== undefined) {
                intentosTexto.textContent = 'Código incorrecto. Intentos restantes: ' + data.intentosRestantes;
                
                if (data.intentosRestantes === 0) {
                    inputCodigo.disabled = true;
                    btnValidar.disabled = true;
                    setTimeout(function() { 
                        CerrarModal(true); 
                        inputCodigo.disabled = false; 
                        btnValidar.disabled = false; 
                    }, 3000);
                    return;
                }
            } else {
                intentosTexto.textContent = data.error || 'Código incorrecto o expirado.';
            }
            
            inputCodigo.value = '';
            inputCodigo.focus();
            restaurarBoton();
        }
    })
    .catch(function(error) {
        console.error('Error validando código:', error);
        alert('Error al validar código. Intenta más tarde.');
        restaurarBoton();
    });
}