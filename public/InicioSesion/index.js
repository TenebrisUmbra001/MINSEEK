/* ========================================
   INICIO DE SESIÓN - Login
======================================== */

function Iniciar() {
    var usuario = document.getElementById('User').value.trim();
    var contrasena = document.getElementById('pass').value;

    // Validaciones básicas
    if (!usuario || !contrasena) {
        alert('Por favor, ingrese usuario y contraseña.');
        return;
    }

    // Mostrar estado de carga
    var btn = document.querySelector('.btn-login');
    var span = btn.querySelector('span');
    var textoOriginal = span.textContent;
    
    btn.disabled = true;
    span.textContent = 'Iniciando...';

    // ✅ Función helper para reemplazar .finally() (no soportado en FF43)
    function restaurarBoton() {
        btn.disabled = false;
        span.textContent = textoOriginal;
    }

    // Enviar solicitud de login a la API pública
    fetch('/api/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            usuario: usuario,
            contrasena: contrasena
        })
    })
    .then(function(response) { 
        return response.json(); 
    })
    .then(function(data) {
        if (data.exitoso) {
            // Login exitoso
            console.log('✅ Login exitoso:', data);

            // Guardar en sesión
            sessionStorage.setItem('idUsuario', data.idUsuario);
            sessionStorage.setItem('usuario', data.usuario);
            sessionStorage.setItem('correo', data.correo);
            sessionStorage.setItem('idConexion', data.idConexion);

            alert('✅ ¡Bienvenido ' + data.usuario + '!');

            // Redirigir al dashboard/chatbot
            window.location.href = '/Chatbot/ChatMinSeek.html';
        } else {
            // Login fallido
            document.getElementById('pass').value = '';
            document.getElementById('User').focus();
            
            alert('❌ ' + (data.error || 'Usuario o contraseña incorrectos.'));
            restaurarBoton();
        }
    })
    .catch(function(error) {
        console.error('Error en login:', error);
        alert('❌ Error al conectar con el servidor. Intenta más tarde.');
        restaurarBoton();
    });
}

/* ========================================
   Función para logout
======================================== */

function Logout() {
    var idConexion = sessionStorage.getItem('idConexion');

    if (!idConexion) {
        console.warn('No hay sesión activa');
        window.location.href = '/';
        return;
    }

    fetch('/api/logout', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            idConexion: idConexion
        })
    })
    .then(function(response) { 
        return response.json(); 
    })
    .then(function(data) {
        if (data.exitoso) {
            console.log('✅ Sesión cerrada en el servidor');
        } else {
            console.error('Error cerrando sesión en servidor:', data.error);
        }
        sessionStorage.clear();
        window.location.href = '/';
    })
    .catch(function(error) {
        console.error('Error de red en logout:', error);
        sessionStorage.clear();
        window.location.href = '/';
    });
}

/* ========================================
   Permitir login con tecla Enter
======================================== */
document.addEventListener('DOMContentLoaded', function() {
    var inputPass = document.getElementById('pass');
    var inputUser = document.getElementById('User');

    // Si presiona Enter en el campo de usuario, pasar al de contraseña
    inputUser.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            inputPass.focus();
        }
    });

    // Si presiona Enter en el campo de contraseña, iniciar sesión
    inputPass.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            Iniciar();
        }
    });
});