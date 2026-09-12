// Browser KeyboardEvent.code -> macOS virtual key / Windows virtual key / X11 keysym / evdev.
const rows = [
  ['KeyA',0,65,'a',30],['KeyS',1,83,'s',31],['KeyD',2,68,'d',32],['KeyF',3,70,'f',33],['KeyH',4,72,'h',35],['KeyG',5,71,'g',34],
  ['KeyZ',6,90,'z',44],['KeyX',7,88,'x',45],['KeyC',8,67,'c',46],['KeyV',9,86,'v',47],['KeyB',11,66,'b',48],
  ['KeyQ',12,81,'q',16],['KeyW',13,87,'w',17],['KeyE',14,69,'e',18],['KeyR',15,82,'r',19],['KeyY',16,89,'y',21],['KeyT',17,84,'t',20],
  ['Digit1',18,49,'1',2],['Digit2',19,50,'2',3],['Digit3',20,51,'3',4],['Digit4',21,52,'4',5],['Digit6',22,54,'6',7],['Digit5',23,53,'5',6],
  ['Equal',24,187,'equal',13],['Digit9',25,57,'9',10],['Digit7',26,55,'7',8],['Minus',27,189,'minus',12],['Digit8',28,56,'8',9],['Digit0',29,48,'0',11],
  ['BracketRight',30,221,'bracketright',27],['KeyO',31,79,'o',24],['KeyU',32,85,'u',22],['BracketLeft',33,219,'bracketleft',26],['KeyI',34,73,'i',23],['KeyP',35,80,'p',25],
  ['Enter',36,13,'Return',28],['KeyL',37,76,'l',38],['KeyJ',38,74,'j',36],['Quote',39,222,'apostrophe',40],['KeyK',40,75,'k',37],['Semicolon',41,186,'semicolon',39],
  ['Backslash',42,220,'backslash',43],['Comma',43,188,'comma',51],['Slash',44,191,'slash',53],['KeyN',45,78,'n',49],['KeyM',46,77,'m',50],['Period',47,190,'period',52],
  ['Tab',48,9,'Tab',15],['Space',49,32,'space',57],['Backquote',50,192,'grave',41],['Backspace',51,8,'BackSpace',14],['Escape',53,27,'Escape',1],
  ['MetaRight',54,92,'Super_R',126],['MetaLeft',55,91,'Super_L',125],['ShiftLeft',56,160,'Shift_L',42],['CapsLock',57,20,'Caps_Lock',58],['AltLeft',58,164,'Alt_L',56],['ControlLeft',59,162,'Control_L',29],
  ['ShiftRight',60,161,'Shift_R',54],['AltRight',61,165,'Alt_R',100],['ControlRight',62,163,'Control_R',97],
  ['F1',122,112,'F1',59],['F2',120,113,'F2',60],['F3',99,114,'F3',61],['F4',118,115,'F4',62],['F5',96,116,'F5',63],['F6',97,117,'F6',64],
  ['F7',98,118,'F7',65],['F8',100,119,'F8',66],['F9',101,120,'F9',67],['F10',109,121,'F10',68],['F11',103,122,'F11',87],['F12',111,123,'F12',88],
  ['Home',115,36,'Home',102],['PageUp',116,33,'Prior',104],['Delete',117,46,'Delete',111],['End',119,35,'End',107],['PageDown',121,34,'Next',109],
  ['ArrowLeft',123,37,'Left',105],['ArrowRight',124,39,'Right',106],['ArrowDown',125,40,'Down',108],['ArrowUp',126,38,'Up',103],
]
export const KEY_CODES = Object.fromEntries(rows.map(([code, mac, windows, x11, evdev]) => [code, { mac, windows, x11, evdev }]))
