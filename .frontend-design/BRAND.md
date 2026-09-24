# Identidad visual del sistema

Dos marcas conviven aquí, con papeles distintos y **no intercambiables**:

- **UNCP** — Universidad Nacional del Centro del Perú. Es la institución dueña
  del sistema. Su escudo dice *de quién es esto*.
- **Nexora** — el estudio que lo construyó. Aporta el sistema visual (color y
  tipografía) y aparece como crédito, nunca como dueño de la pantalla.

Decidido con el usuario el 23 de septiembre de 2026.

---

## 1. Conocido (valores oficiales, tomados de los manuales)

### Nexora

| Color | Papel declarado en el manual |
|---|---|
| `#0B1F3A` | Confianza, profesionalismo |
| `#2563EB` | Innovación, tecnología |
| `#38BDF8` | Conexión, frescura |
| `#E5E7EB` | Soporte, equilibrio |
| `#FFFFFF` | Claridad, limpieza |

Tipografía: **Sora**, SemiBold y Regular.

Logo: isotipo «N» con nodos de circuito, en degradado azul, más el logotipo
«Nexora». Usos incorrectos declarados: **no cambiar colores, no deformar, no
añadir efectos, no usar sobre fondos que pierdan contraste**.

### UNCP

Colores muestreados del escudo oficial entregado (no vienen declarados en un
manual, así que se registran como medidos, no como valores de marca):

| Color medido | Presencia | Dónde |
|---|---|---|
| `#507840` | 23 % | Verde del fondo del escudo |
| `#C8B070` | 21 % | Dorado del aro y la figura |
| `#202020` | 17 % | Negro del aro exterior y el texto |

Piezas disponibles, extraídas con transparencia a 1024 px de ancho:
escudo a color, escudo monocromático blanco, versión vertical con nombre,
versión horizontal con nombre.

---

## 2. Bloqueado (no se toca sin permiso explícito)

1. **Los logos se usan tal como llegaron.** Ni recoloreados, ni deformados, ni
   con sombras, brillos o contornos. Solo se escalan proporcionalmente.
2. **El verde y el dorado de la UNCP no se convierten en colores de interfaz.**
   El verde ya significa *puntual* en este sistema; usarlo además como color de
   marca haría ambiguo el dato más importante de la pantalla.
3. **La semántica de estados no cambia con la marca.** Puntual verde, tardanza
   ámbar, falta rojo, crítico rojo intenso. Es información, no decoración, y
   está probada así en la aplicación y en el panel.
4. **Nexora no compite con la UNCP** en ninguna pantalla: aparece una sola vez,
   en el pie, a tamaño de crédito.

---

## 3. Derivado (papeles de UI a partir de los valores oficiales)

No se inventa ningún color nuevo: cada papel sale de la paleta de Nexora.

| Papel | Valor | Uso |
|---|---|---|
| Dominante | `#0B1F3A` | Barra de aplicación, barra lateral, títulos, texto fuerte |
| Acción | `#2563EB` | Botones primarios, enlaces, anillo de foco |
| Acento | `#38BDF8` | Selección, indicadores, el punto vivo del mapa |
| Borde | `#E5E7EB` | Separadores, bordes de tarjeta y de campo |
| Superficie | `#FFFFFF` | Tarjetas, formularios, tablas |
| Fondo | `#F8FAFC` | Lienzo de la aplicación (blanco roto, ya en uso) |

Tipografía:

- **Sora SemiBold** para títulos, cifras grandes y etiquetas de estado.
- **Sora Regular** para el resto.
- Las horas y las cifras usan cifras tabulares: una columna de horas tiene que
  alinearse.
- Se sirve **desde el propio servidor**, no desde un CDN: el sistema debe
  funcionar en una red sin salida a internet.

---

## 4. Propuesto (aplicación concreta)

| Dónde | Qué aparece |
|---|---|
| Login de la app y del panel | Escudo UNCP + «Universidad Nacional del Centro del Perú» |
| Barra de aplicación (móvil) | Escudo UNCP pequeño junto al rol |
| Barra lateral (panel) | Versión horizontal con nombre |
| Icono de la aplicación Android | Escudo UNCP a color |
| Favicon del panel | Escudo UNCP |
| Cabecera de los reportes PDF | Versión horizontal con nombre |
| Pie del login y pantalla de privacidad | Isotipo Nexora + «Desarrollado por Nexora» |

---

## 5. Anti-objetivos

- **Nada de decoración.** Esto es una herramienta de control de asistencia: si un
  elemento no ayuda a leer un dato o a tomar una acción, sobra.
- **Nada de degradados de fondo, sombras largas ni animaciones de entrada.** La
  pantalla se consulta decenas de veces al día.
- **Ningún color nuevo** fuera de la paleta declarada y de los colores de estado
  que ya existen.
- **El escudo no se usa como textura ni como marca de agua** detrás del
  contenido.
