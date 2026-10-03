plugins {
    id("com.android.application")
}

android {
    namespace = "com.example.xpreststudio"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.xpreststudio"
        minSdk = 24
        targetSdk = 34
        versionCode = 2
        versionName = "2.0"
    }

    sourceSets {
        getByName("main") {
            // Aset web lokal disertakan agar editor terbuka instan 0 detik via WebViewAssetLoader
            assets.srcDirs("src/main/assets")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // AndroidX WebKit untuk WebViewAssetLoader (buka editor instan dari aset lokal via origin HTTPS)
    implementation("androidx.webkit:webkit:1.10.0")
}

