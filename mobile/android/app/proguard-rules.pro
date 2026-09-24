# Reglas de ofuscacion y reduccion.
#
# Flutter y sus plugins usan reflexion en algunos puntos; estas reglas evitan
# que R8 elimine clases que se resuelven en tiempo de ejecucion.

# --- Flutter ---------------------------------------------------------------
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }
-keep class io.flutter.embedding.** { *; }

# --- Plugins usados por la aplicacion --------------------------------------
-keep class com.baseflow.geolocator.** { *; }
-keep class com.baseflow.permissionhandler.** { *; }
-keep class io.flutter.plugins.camera.** { *; }

# --- Almacenamiento cifrado (Android Keystore / Tink) ----------------------
-keep class com.it_nomads.fluttersecurestorage.** { *; }
-keep class androidx.security.crypto.** { *; }
-keep class com.google.crypto.tink.** { *; }
-dontwarn com.google.crypto.tink.**

# --- No filtrar nombres de fuente en las trazas de produccion --------------
-renamesourcefileattribute SourceFile
-keepattributes SourceFile,LineNumberTable

# --- Play Core (componentes diferidos) --------------------------------------
# El motor de Flutter referencia estas clases para descargar partes de la app
# bajo demanda desde Google Play. Esta aplicacion no usa componentes diferidos,
# asi que las clases no estan y R8 solo debe no fallar por ellas.
-dontwarn com.google.android.play.core.**
