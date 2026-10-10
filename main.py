import re
import secrets
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import MySQLdb
from flask import Flask, jsonify, render_template, request, session
from flask_mysqldb import MySQL
from werkzeug.exceptions import HTTPException

app = Flask(__name__)
app.secret_key = 'innovajusta_secret_key'
app.config.update(MAX_CONTENT_LENGTH=64 * 1024, SESSION_COOKIE_HTTPONLY=True,
                  SESSION_COOKIE_SAMESITE='Lax',
                  MYSQL_HOST='localhost', MYSQL_PORT=3306, MYSQL_USER='root',
                  MYSQL_PASSWORD='Valentina/12', MYSQL_DB='innovajusta',
                  MYSQL_CURSORCLASS='DictCursor', MYSQL_CHARSET='utf8mb4')
mysql = MySQL(app)


class Validacion(Exception):
    pass


def texto(d, key, maximo, obligatorio=False, defecto=None):
    value = d.get(key, defecto)
    if value is None:
        value = ''
    if not isinstance(value, str):
        raise Validacion(f'{key}: debe ser texto.')
    value = value.strip()
    if obligatorio and not value:
        raise Validacion(f'{key}: campo obligatorio.')
    if len(value) > maximo:
        raise Validacion(f'{key}: mÃ¡ximo {maximo} caracteres.')
    return value or None


def entero(d, key, minimo=0, defecto=None):
    value = d.get(key, defecto)
    if isinstance(value, bool) or not re.fullmatch(r'\d+', str(value)):
        raise Validacion(f'{key}: escribe un nÃºmero entero.')
    value = int(value)
    if not minimo <= value <= 2147483647:
        raise Validacion(f'{key}: valor fuera de rango (mÃ­nimo {minimo}).')
    return value


def dinero(d, key):
    try:
        value = Decimal(str(d.get(key)))
        if not value.is_finite() or value < 0 or value > Decimal('99999999.99'):
            raise ValueError()
        if value != value.quantize(Decimal('.01')):
            raise ValueError()
        return value.quantize(Decimal('.01'))
    except (InvalidOperation, ValueError, TypeError):
        raise Validacion(f'{key}: usa un valor entre 0 y 99999999.99, con mÃ¡ximo dos decimales.')


def opcion(d, key, opciones, defecto):
    value = d.get(key) or defecto
    if value not in opciones:
        raise Validacion(f'{key}: opciÃ³n no vÃ¡lida.')
    return value


def fecha(d, key):
    value = d.get(key)
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        raise Validacion(f'{key}: usa una fecha vÃ¡lida (AAAA-MM-DD).')


def json_datos():
    if not request.is_json:
        raise Validacion('Se requiere contenido JSON.')
    value = request.get_json()
    if not isinstance(value, dict):
        raise Validacion('Los datos deben ser un objeto JSON.')
    return value


@contextmanager
def base():
    conexion = None
    cursor = None
    try:
        conexion = mysql.connection
        cursor = conexion.cursor()
        yield cursor
        conexion.commit()
    except Exception:
        if conexion is not None:
            conexion.rollback()
        raise
    finally:
        if cursor is not None:
            cursor.close()
        # Flask-MySQLdb cierra la conexiÃ³n al finalizar la peticiÃ³n.


def insertar(cursor, tabla, datos):
    # Las tablas y las columnas proceden exclusivamente del cÃ³digo del servidor.
    columnas = ', '.join(datos)
    marcas = ', '.join(['%s'] * len(datos))
    cursor.execute(f'INSERT INTO {tabla} ({columnas}) VALUES ({marcas})', tuple(datos.values()))
    return cursor.lastrowid


def referencia(cursor, tabla, campo, valor):
    cursor.execute(f'SELECT {campo}, estado FROM {tabla} WHERE {campo} = %s FOR UPDATE', (valor,))
    row = cursor.fetchone()
    if not row or row['estado'] != 'Activo':
        raise Validacion(f'{tabla}: selecciona un registro activo existente.')


def producto_bloqueado(cursor, identificador):
    cursor.execute('SELECT * FROM producto WHERE id_producto = %s FOR UPDATE', (identificador,))
    row = cursor.fetchone()
    if not row or row['estado'] != 'Activo':
        raise Validacion('Selecciona un producto activo existente.')
    return row


def movimiento(cursor, producto_id, entrada, salida, actual, observacion):
    insertar(cursor, 'inventario', dict(id_producto=producto_id, cantidad_entrada=entrada,
             cantidad_salida=salida, stock_actual=actual, observaciones=observacion))


@app.before_request
def proteger_formularios():
    if request.method == 'POST':
        token = session.get('csrf_token')
        recibido = request.headers.get('X-CSRF-Token', '')
        if not token or not secrets.compare_digest(token, recibido):
            return jsonify(error='La sesiÃ³n cambiÃ³. Recarga la pÃ¡gina e intenta de nuevo.'), 403


@app.get('/')
def index():
    session.setdefault('csrf_token', secrets.token_hex(32))
    return render_template('Pagina-principal.html', csrf_token=session['csrf_token'])


@app.errorhandler(Validacion)
def validacion_error(error):
    return jsonify(error=str(error)), 400


@app.errorhandler(MySQLdb.Error)
def mysql_error(error):
    codigo = error.args[0] if error.args else None
    if codigo == 1062:
        return jsonify(error='Ya existe un registro con ese documento o correo.'), 409
    if codigo in (1451, 1452):
        return jsonify(error='El registro relacionado no existe o estÃ¡ en uso.'), 409
    if codigo in (1205, 1213):
        return jsonify(error='La base de datos estÃ¡ ocupada. Intenta de nuevo.'), 409
    app.logger.exception('Error MySQL')
    return jsonify(error='No se pudo completar la operaciÃ³n. Revisa MySQL, la configuraciÃ³n de main.py y la consola.'), 503


@app.errorhandler(HTTPException)
def http_error(error):
    return jsonify(error=error.description), error.code


@app.errorhandler(Exception)
def inesperado(error):
    app.logger.exception('Error inesperado')
    return jsonify(error='OcurriÃ³ un error interno. Revisa la consola de PyCharm.'), 500


@app.post('/guardar-emprendedor')
def guardar_emprendedor():
    d = json_datos()
    correo = texto(d, 'correo', 150, True)
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', correo):
        raise Validacion('Escribe un correo vÃ¡lido.')
    datos = dict(nombre=texto(d, 'nombre', 150, True),
                 tipo_documento=texto(d, 'tipo_documento', 50, True),
                 numero_documento=texto(d, 'numero_documento', 30, True),
                 telefono=texto(d, 'telefono', 20), correo=correo,
                 direccion=texto(d, 'direccion', 255),
                 tipo_poblacion=texto(d, 'tipo_poblacion', 100),
                 estado=opcion(d, 'estado', ['Activo', 'Inactivo'], 'Activo'))
    with base() as c:
        nuevo_id = insertar(c, 'emprendedor', datos)
    return jsonify(mensaje='Emprendedor registrado.', id=nuevo_id), 201


@app.post('/guardar-categoria')
def guardar_categoria():
    d = json_datos()
    datos = dict(nombre=texto(d, 'nombre', 100, True), descripcion=texto(d, 'descripcion', 10000),
                 estado=opcion(d, 'estado', ['Activo', 'Inactivo'], 'Activo'))
    with base() as c:
        nuevo_id = insertar(c, 'categoria', datos)
    return jsonify(mensaje='CategorÃ­a registrada.', id=nuevo_id), 201


@app.post('/guardar-producto')
def guardar_producto():
    d = json_datos()
    datos = dict(id_emprendedor=entero(d, 'id_emprendedor', 1),
                 id_categoria=entero(d, 'id_categoria', 1), nombre=texto(d, 'nombre', 150, True),
                 descripcion=texto(d, 'descripcion', 10000), precio_venta=dinero(d, 'precio_venta'),
                 stock_actual=entero(d, 'stock_actual', defecto=0),
                 fecha_vencimiento=fecha(d, 'fecha_vencimiento'),
                 estado=opcion(d, 'estado', ['Activo', 'Inactivo'], 'Activo'))
    with base() as c:
        referencia(c, 'emprendedor', 'id_emprendedor', datos['id_emprendedor'])
        referencia(c, 'categoria', 'id_categoria', datos['id_categoria'])
        nuevo_id = insertar(c, 'producto', datos)
        if datos['stock_actual']:
            movimiento(c, nuevo_id, datos['stock_actual'], 0, datos['stock_actual'], 'Existencias iniciales')
    return jsonify(mensaje='Producto registrado.', id=nuevo_id), 201


@app.post('/guardar-inventario')
def guardar_inventario():
    d = json_datos()
    identificador = entero(d, 'id_producto', 1)
    entrada = entero(d, 'cantidad_entrada', defecto=0)
    salida = entero(d, 'cantidad_salida', defecto=0)
    if (entrada > 0) == (salida > 0):
        raise Validacion('Registra una entrada o una salida, una por movimiento.')
    observacion = texto(d, 'observaciones', 10000)
    with base() as c:
        p = producto_bloqueado(c, identificador)
        nuevo_stock = p['stock_actual'] + entrada - salida
        if not 0 <= nuevo_stock <= 2147483647:
            raise Validacion('No hay existencias suficientes o el stock supera el mÃ¡ximo permitido.')
        c.execute('UPDATE producto SET stock_actual = %s WHERE id_producto = %s', (nuevo_stock, identificador))
        movimiento(c, identificador, entrada, salida, nuevo_stock, observacion)
    return jsonify(mensaje=f'Movimiento registrado. Existencias: {nuevo_stock}.'), 201


@app.post('/guardar-venta')
def guardar_venta():
    d = json_datos()
    emprendedor_id = entero(d, 'id_emprendedor', 1)
    contacto = texto(d, 'metodo_contacto', 100, True, 'WhatsApp')
    detalles = d.get('detalles')
    if not isinstance(detalles, list) or not 1 <= len(detalles) <= 100:
        raise Validacion('Añade entre 1 y 100 productos a la venta.')
    lineas = []
    usados = set()
    total = Decimal('0.00')
    for item in detalles:
        if not isinstance(item, dict):
            raise Validacion('El detalle de venta no es vÃ¡lido.')
        producto_id = entero(item, 'id_producto', 1)
        if producto_id in usados:
            raise Validacion('Agrupa la cantidad de cada producto en una sola fila.')
        usados.add(producto_id)
        cantidad = entero(item, 'cantidad', 1)
        precio = dinero(item, 'precio_unitario')
        subtotal = (precio * cantidad).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
        total += subtotal
        if total > Decimal('99999999.99'):
            raise Validacion('El total supera el lÃ­mite de la base de datos.')
        lineas.append((producto_id, cantidad, precio, subtotal))
    with base() as c:
        referencia(c, 'emprendedor', 'id_emprendedor', emprendedor_id)
        productos = {}
        # Orden estable de bloqueos para reducir conflictos entre ventas simultÃ¡neas.
        for producto_id, cantidad, _, _ in sorted(lineas):
            p = producto_bloqueado(c, producto_id)
            if p['id_emprendedor'] != emprendedor_id:
                raise Validacion('Todos los productos deben pertenecer al emprendedor seleccionado.')
            if p['stock_actual'] < cantidad:
                raise Validacion(f'Existencias insuficientes para {p["nombre"]}: disponibles {p["stock_actual"]}.')
            productos[producto_id] = p
        venta_id = insertar(c, 'venta', dict(id_emprendedor=emprendedor_id, total=total,
                                            metodo_contacto=contacto, estado='Confirmada'))
        for producto_id, cantidad, precio, subtotal in lineas:
            insertar(c, 'detalle_venta', dict(id_venta=venta_id, id_producto=producto_id,
                     cantidad=cantidad, precio_unitario=precio, subtotal=subtotal))
            nuevo_stock = productos[producto_id]['stock_actual'] - cantidad
            c.execute('UPDATE producto SET stock_actual = %s WHERE id_producto = %s', (nuevo_stock, producto_id))
            movimiento(c, producto_id, 0, cantidad, nuevo_stock, f'Venta #{venta_id}')
    return jsonify(mensaje=f'Venta #{venta_id} confirmada. Total: {total}.', id=venta_id), 201


@app.post('/guardar-pedido')
@app.post('/guardar-pedido_whatsapp')
def guardar_pedido():
    d = json_datos()
    datos = dict(id_emprendedor=entero(d, 'id_emprendedor', 1),
                 detalle_pedido=texto(d, 'detalle_pedido', 10000, True),
                 estado=opcion(d, 'estado', ['Enviado', 'Atendido', 'Finalizado'], 'Enviado'),
                 canal=texto(d, 'canal', 50, True, 'WhatsApp'))
    with base() as c:
        referencia(c, 'emprendedor', 'id_emprendedor', datos['id_emprendedor'])
        nuevo_id = insertar(c, 'pedido_whatsapp', datos)
    return jsonify(mensaje='Pedido registrado. Este registro no envÃ­a mensajes a WhatsApp.', id=nuevo_id), 201


CONSULTAS = {
    'emprendedor': 'SELECT * FROM emprendedor ORDER BY id_emprendedor DESC LIMIT 200',
    'categoria': 'SELECT * FROM categoria ORDER BY id_categoria DESC LIMIT 200',
    'producto': 'SELECT * FROM producto ORDER BY id_producto DESC LIMIT 200',
    'inventario': 'SELECT * FROM inventario ORDER BY id_inventario DESC LIMIT 200',
    'venta': 'SELECT * FROM venta ORDER BY id_venta DESC LIMIT 200',
    'detalle': 'SELECT * FROM detalle_venta ORDER BY id_detalle DESC LIMIT 200',
    'pedido': 'SELECT * FROM pedido_whatsapp ORDER BY id_pedido DESC LIMIT 200',
}


def serializar(rows):
    return [{key: str(value) if isinstance(value, Decimal) else value.isoformat() if isinstance(value, (date, datetime)) else value
             for key, value in row.items()} for row in rows]


@app.get('/api/registros/<tipo>')
def registros(tipo):
    if tipo not in CONSULTAS:
        return jsonify(error='SecciÃ³n no encontrada.'), 404
    with base() as c:
        c.execute(CONSULTAS[tipo])
        rows = c.fetchall()
    return jsonify(registros=serializar(rows))


@app.get('/api/catalogos')
def catalogos():
    with base() as c:
        c.execute("SELECT id_emprendedor, nombre FROM emprendedor WHERE estado = 'Activo' ORDER BY nombre")
        emprendedores = c.fetchall()
        c.execute("SELECT id_categoria, nombre FROM categoria WHERE estado = 'Activo' ORDER BY nombre")
        categorias = c.fetchall()
        c.execute("SELECT id_producto, id_emprendedor, nombre, precio_venta, stock_actual FROM producto WHERE estado = 'Activo' ORDER BY nombre")
        productos = c.fetchall()
    return jsonify(emprendedores=serializar(emprendedores), categorias=serializar(categorias), productos=serializar(productos))
if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=False)