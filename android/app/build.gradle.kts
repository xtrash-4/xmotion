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
        versionCode = 1
        versionName = "1.0"
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
    // Standard built-in Android framework WebView & Activity
}
