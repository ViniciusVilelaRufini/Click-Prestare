# Flutter
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.**  { *; }
-keep class io.flutter.util.**  { *; }
-keep class io.flutter.view.**  { *; }
-keep class io.flutter.**  { *; }
-keep class io.flutter.plugins.**  { *; }
-keep class io.flutter.embedding.** { *; }
-dontwarn io.flutter.embedding.**

# Firebase / Google Play services
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# Keep enums and Parcelables
-keepclassmembers enum * { *; }
-keep class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator *;
}

# Gson / JSON serialization (manter annotations)
-keepattributes Signature
-keepattributes *Annotation*
-keepattributes EnclosingMethod
-keepattributes InnerClasses

# OkHttp / Retrofit (caso pacotes Flutter usem)
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**

# Stripe / Billing
-keep class com.android.billingclient.** { *; }

# Manter classes do projeto (model classes serializadas)
-keep class br.com.clickprestare.app.** { *; }

# Evita remoção de métodos nativos (JNI)
-keepclasseswithmembernames class * {
    native <methods>;
}

# Google Play In-App Review
-keep class com.google.android.play.core.** { *; }
-dontwarn com.google.android.play.core.**
