import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("dev.flutter.flutter-gradle-plugin")
}

// -----------------------------------------------------------------------------
// Firma de la aplicacion
//
// Las credenciales del almacen de claves NUNCA se versionan. Se leen de
// android/key.properties, que esta en .gitignore. Si el archivo no existe (por
// ejemplo, en un equipo de desarrollo), la compilacion de release usa la clave
// de depuracion para que `flutter build apk --release` siga funcionando, pero
// ese APK NO sirve para distribuir.
// -----------------------------------------------------------------------------
val propiedadesFirma = Properties()
val archivoFirma = rootProject.file("key.properties")
val hayFirmaPropia = archivoFirma.exists()
if (hayFirmaPropia) {
    propiedadesFirma.load(FileInputStream(archivoFirma))
}

android {
    namespace = "pe.edu.personalclass.asistencia_app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // Necesario para las APIs de fecha y hora de Java 8 en versiones
        // antiguas de Android.
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        applicationId = "pe.edu.personalclass.asistencia_app"
        // Android 7.0 (API 24). Es el minimo que exige Flutter 3.47 y cubre los
        // permisos en tiempo de ejecucion y EncryptedSharedPreferences, que la
        // aplicacion necesita para guardar tokens y huella de forma segura.
        minSdk = 24
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        resourceConfigurations += listOf("es")
    }

    signingConfigs {
        if (hayFirmaPropia) {
            create("release") {
                keyAlias = propiedadesFirma["keyAlias"] as String?
                keyPassword = propiedadesFirma["keyPassword"] as String?
                storeFile = (propiedadesFirma["storeFile"] as String?)?.let { file(it) }
                storePassword = propiedadesFirma["storePassword"] as String?
            }
        }
    }

    buildTypes {
        getByName("release") {
            signingConfig = if (hayFirmaPropia) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
            // Se reduce y ofusca el codigo. Las reglas adicionales viven en
            // proguard-rules.pro.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }

        getByName("debug") {
            // Sufijo para poder tener instaladas a la vez la version de
            // desarrollo y la de produccion en el mismo telefono.
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
        }
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

// Kotlin debe apuntar a la misma version de JVM que Java (17). Sin esto toma la
// del JDK que ejecuta Gradle (25 en el Android Studio actual) y la compilacion
// falla por "Inconsistent JVM Target Compatibility".
kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}

flutter {
    source = "../.."
}
