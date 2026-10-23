"""Private X11 window placement, clipboard and input. Protocol values are never logged."""
import ctypes as C
import json
import os
import select
import sys


class WindowAttributes(C.Structure):
    _fields_ = [('x', C.c_int), ('y', C.c_int), ('width', C.c_int), ('height', C.c_int), ('border_width', C.c_int), ('depth', C.c_int), ('visual', C.c_void_p), ('root', C.c_ulong), ('klass', C.c_int), ('bit_gravity', C.c_int), ('win_gravity', C.c_int), ('backing_store', C.c_int), ('backing_planes', C.c_ulong), ('backing_pixel', C.c_ulong), ('save_under', C.c_int), ('colormap', C.c_ulong), ('map_installed', C.c_int), ('map_state', C.c_int), ('all_event_masks', C.c_long), ('your_event_mask', C.c_long), ('do_not_propagate_mask', C.c_long), ('override_redirect', C.c_int), ('screen', C.c_void_p)]


class AnyEvent(C.Structure):
    _fields_ = [('type', C.c_int), ('serial', C.c_ulong), ('send_event', C.c_int), ('display', C.c_void_p), ('window', C.c_ulong)]


class MapRequest(C.Structure):
    _fields_ = AnyEvent._fields_[:-1] + [('parent', C.c_ulong), ('window', C.c_ulong)]


class ConfigureRequest(C.Structure):
    _fields_ = MapRequest._fields_ + [('x', C.c_int), ('y', C.c_int), ('width', C.c_int), ('height', C.c_int), ('border_width', C.c_int), ('above', C.c_ulong), ('detail', C.c_int), ('value_mask', C.c_ulong)]


class ClientMessageData(C.Union):
    _fields_ = [('b', C.c_char * 20), ('s', C.c_short * 10), ('l', C.c_long * 5)]


class ClientMessage(C.Structure):
    _fields_ = AnyEvent._fields_ + [('message_type', C.c_ulong), ('format', C.c_int), ('data', ClientMessageData)]


class SelectionRequest(C.Structure):
    _fields_ = AnyEvent._fields_[:-1] + [('owner', C.c_ulong), ('requestor', C.c_ulong), ('selection', C.c_ulong), ('target', C.c_ulong), ('property', C.c_ulong), ('time', C.c_ulong)]


class SelectionNotify(C.Structure):
    _fields_ = AnyEvent._fields_[:-1] + [('requestor', C.c_ulong), ('selection', C.c_ulong), ('target', C.c_ulong), ('property', C.c_ulong), ('time', C.c_ulong)]


class Event(C.Union):
    _fields_ = [('type', C.c_int), ('any', AnyEvent), ('map', MapRequest), ('configure', ConfigureRequest), ('client', ClientMessage), ('selection', SelectionRequest), ('notify', SelectionNotify), ('pad', C.c_long * 24)]


x = C.CDLL('libX11.so.6')
xt = C.CDLL('libXtst.so.6')


def function(library, name, restype, *argtypes):
    result = getattr(library, name)
    result.restype, result.argtypes = restype, list(argtypes)
    return result


display = function(x, 'XOpenDisplay', C.c_void_p, C.c_char_p)(None)
if not display:
    raise SystemExit(1)
root = function(x, 'XDefaultRootWindow', C.c_ulong, C.c_void_p)(display)
width, height = int(sys.argv[1]), int(sys.argv[2])
intern = function(x, 'XInternAtom', C.c_ulong, C.c_void_p, C.c_char_p, C.c_int)
atom = lambda name: intern(display, name.encode(), 0)
flush = function(x, 'XFlush', C.c_int, C.c_void_p)
pending = function(x, 'XPending', C.c_int, C.c_void_p)
next_event = function(x, 'XNextEvent', C.c_int, C.c_void_p, C.POINTER(Event))
attributes = function(x, 'XGetWindowAttributes', C.c_int, C.c_void_p, C.c_ulong, C.POINTER(WindowAttributes))
move_window = function(x, 'XMoveResizeWindow', C.c_int, C.c_void_p, C.c_ulong, C.c_int, C.c_int, C.c_uint, C.c_uint)
map_window = function(x, 'XMapWindow', C.c_int, C.c_void_p, C.c_ulong)
raise_window = function(x, 'XRaiseWindow', C.c_int, C.c_void_p, C.c_ulong)
focus_window = function(x, 'XSetInputFocus', C.c_int, C.c_void_p, C.c_ulong, C.c_int, C.c_ulong)
send_event = function(x, 'XSendEvent', C.c_int, C.c_void_p, C.c_ulong, C.c_int, C.c_long, C.POINTER(Event))
property_set = function(x, 'XChangeProperty', C.c_int, C.c_void_p, C.c_ulong, C.c_ulong, C.c_ulong, C.c_int, C.c_int, C.c_void_p, C.c_int)
owner_set = function(x, 'XSetSelectionOwner', C.c_int, C.c_void_p, C.c_ulong, C.c_ulong, C.c_ulong)
keycode = function(x, 'XKeysymToKeycode', C.c_ubyte, C.c_void_p, C.c_ulong)
keysym = function(x, 'XStringToKeysym', C.c_ulong, C.c_char_p)
motion = function(xt, 'XTestFakeMotionEvent', C.c_int, C.c_void_p, C.c_int, C.c_int, C.c_int, C.c_ulong)
button = function(xt, 'XTestFakeButtonEvent', C.c_int, C.c_void_p, C.c_uint, C.c_int, C.c_ulong)
key_event = function(xt, 'XTestFakeKeyEvent', C.c_int, C.c_void_p, C.c_uint, C.c_int, C.c_ulong)
query = function(x, 'XQueryPointer', C.c_int, C.c_void_p, C.c_ulong, C.POINTER(C.c_ulong), C.POINTER(C.c_ulong), C.POINTER(C.c_int), C.POINTER(C.c_int), C.POINTER(C.c_int), C.POINTER(C.c_int), C.POINTER(C.c_uint))
create_window = function(x, 'XCreateSimpleWindow', C.c_ulong, C.c_void_p, C.c_ulong, C.c_int, C.c_int, C.c_uint, C.c_uint, C.c_uint, C.c_ulong, C.c_ulong)
clipboard_window = create_window(display, root, -10, -10, 1, 1, 0, 0, 0)
clipboard, utf8, targets, string = atom('CLIPBOARD'), atom('UTF8_STRING'), atom('TARGETS'), atom('STRING')
wm_protocols, wm_delete, active_atom = atom('WM_PROTOCOLS'), atom('WM_DELETE_WINDOW'), atom('_NET_ACTIVE_WINDOW')
error_handler_type = C.CFUNCTYPE(C.c_int, C.c_void_p, C.c_void_p)
error_handler = error_handler_type(lambda _display, _event: 0)
function(x, 'XSetErrorHandler', C.c_void_p, error_handler_type)(error_handler)
function(x, 'XSelectInput', C.c_int, C.c_void_p, C.c_ulong, C.c_long)(display, root, (1 << 20) | (1 << 19))
function(x, 'XSync', C.c_int, C.c_void_p, C.c_int)(display, 0)
windows, held_keys, held_buttons = [], set(), set()
clipboard_text, buffer = '', b''


def focus(window):
    if window and window != clipboard_window:
        raise_window(display, window)
        focus_window(display, window, 2, 0)


def release():
    for code in held_keys:
        key_event(display, code, 0, 0)
    for number in held_buttons:
        button(display, number, 0, 0)
    held_keys.clear()
    held_buttons.clear()
    flush(display)


def native_key(code, key):
    names = {'Enter': 'Return', 'Escape': 'Escape', 'Backspace': 'BackSpace', 'Tab': 'Tab', 'Space': 'space', 'ArrowLeft': 'Left', 'ArrowRight': 'Right', 'ArrowUp': 'Up', 'ArrowDown': 'Down', 'Delete': 'Delete', 'Insert': 'Insert', 'Home': 'Home', 'End': 'End', 'PageUp': 'Prior', 'PageDown': 'Next', 'ShiftLeft': 'Shift_L', 'ShiftRight': 'Shift_R', 'ControlLeft': 'Control_L', 'ControlRight': 'Control_R', 'AltLeft': 'Alt_L', 'AltRight': 'Alt_R', 'MetaLeft': 'Super_L', 'MetaRight': 'Super_R', 'CapsLock': 'Caps_Lock', 'Minus': 'minus', 'Equal': 'equal', 'BracketLeft': 'bracketleft', 'BracketRight': 'bracketright', 'Backslash': 'backslash', 'Semicolon': 'semicolon', 'Quote': 'apostrophe', 'Comma': 'comma', 'Period': 'period', 'Slash': 'slash', 'Backquote': 'grave'}
    name = code[3:].lower() if code.startswith('Key') and len(code) == 4 else code[5:] if code.startswith('Digit') else names.get(code, names.get(key, code if code.startswith('F') and code[1:].isdigit() else key))
    sym = keysym(name.encode())
    return keycode(display, sym) if sym else 0


def close_windows():
    release()
    for window in list(windows):
        event = Event()
        event.client.type, event.client.window, event.client.message_type, event.client.format = 33, window, wm_protocols, 32
        event.client.data.l[0], event.client.data.l[1] = wm_delete, 0
        send_event(display, window, 0, 0, C.byref(event))
    flush(display)


def command(message):
    global clipboard_text, width, height
    kind = message.get('type')
    if kind == 'release':
        release()
    elif kind == 'resize':
        release()
        width, height = message['width'], message['height']
        for window in windows:
            move_window(display, window, 0, 0, width, height)
        function(x, 'XSync', C.c_int, C.c_void_p, C.c_int)(display, 0)
        print(json.dumps({'type': 'resized', 'width': width, 'height': height}), flush=True)
    elif kind == 'shutdown':
        close_windows()
    elif kind in ('pointer', 'button'):
        if 'x' in message and 'y' in message:
            motion(display, -1, max(0, min(width - 1, round(message['x']))), max(0, min(height - 1, round(message['y']))), 0)
        if kind == 'button':
            if message['down']:
                root_return, child = C.c_ulong(), C.c_ulong()
                a, b, c, d, mask = C.c_int(), C.c_int(), C.c_int(), C.c_int(), C.c_uint()
                query(display, root, C.byref(root_return), C.byref(child), C.byref(a), C.byref(b), C.byref(c), C.byref(d), C.byref(mask))
                if child.value in windows:
                    focus(child.value)
            number = [1, 2, 3][message['button']]
            button(display, number, int(message['down']), 0)
            (held_buttons.add if message['down'] else held_buttons.discard)(number)
    elif kind == 'wheel':
        for delta, positive, negative in [(message['deltaY'], 5, 4), (message['deltaX'], 7, 6)]:
            if delta:
                number = positive if delta > 0 else negative
                for _ in range(min(12, max(1, round(abs(delta) / 80)))):
                    button(display, number, 1, 0)
                    button(display, number, 0, 0)
    elif kind == 'key':
        native = native_key(message['code'], message['key'])
        if native:
            key_event(display, native, int(message['down']), 0)
            (held_keys.add if message['down'] else held_keys.discard)(native)
    elif kind == 'paste':
        release()
        clipboard_text = message['text']
        owner_set(display, clipboard, clipboard_window, 0)
        control, v = native_key('ControlLeft', ''), native_key('KeyV', '')
        for native, down in [(control, 1), (v, 1), (v, 0), (control, 0)]:
            key_event(display, native, down, 0)
    flush(display)


def event_received(event):
    if event.type == 20:
        window = event.map.window
        attrs = WindowAttributes()
        if attributes(display, window, C.byref(attrs)):
            move_window(display, window, 0, 0, width, height)
            map_window(display, window)
            if window not in windows:
                windows.append(window)
            focus(window)
    elif event.type == 23:
        move_window(display, event.configure.window, 0, 0, width, height)
    elif event.type in (17, 18):
        # Destroy/Unmap events carry the affected window after the event window.
        window = event.map.window
        if window in windows:
            windows.remove(window)
            if windows:
                focus(windows[-1])
    elif event.type == 33 and event.client.message_type == active_atom:
        focus(event.client.window)
    elif event.type == 30:
        request = event.selection
        prop = request.property or request.target
        success = False
        if request.target == targets:
            supported = (C.c_ulong * 3)(targets, utf8, string)
            property_set(display, request.requestor, prop, atom('ATOM'), 32, 0, supported, 3)
            success = True
        elif request.target in (utf8, string, atom('TEXT')):
            data = clipboard_text.encode('latin-1', 'replace') if request.target == string else clipboard_text.encode('utf-8')
            property_set(display, request.requestor, prop, request.target, 8, 0, C.c_char_p(data), len(data))
            success = True
        response = Event()
        response.notify.type, response.notify.requestor, response.notify.selection = 31, request.requestor, request.selection
        response.notify.target, response.notify.property, response.notify.time = request.target, prop if success else 0, request.time
        send_event(display, request.requestor, 0, 0, C.byref(response))
    flush(display)


print(json.dumps({'type': 'ready'}), flush=True)
connection = function(x, 'XConnectionNumber', C.c_int, C.c_void_p)(display)
try:
    running = True
    while running:
        while pending(display):
            event = Event()
            next_event(display, C.byref(event))
            event_received(event)
        readable, _, _ = select.select([0, connection], [], [], 0.1)
        if 0 in readable:
            data = os.read(0, 8192)
            if not data:
                break
            buffer += data
            if len(buffer) > 65536:
                break
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                try:
                    command(json.loads(line))
                except (ValueError, TypeError, KeyError, IndexError):
                    running = False
                    break
finally:
    release()
    function(x, 'XCloseDisplay', C.c_int, C.c_void_p)(display)
