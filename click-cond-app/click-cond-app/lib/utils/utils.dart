import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:file_picker/file_picker.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_typography.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:open_filex/open_filex.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart';
import 'package:path_provider/path_provider.dart';

const _kHttpTimeout = Duration(seconds: 15);

Future<void> launchInBrowser(String url, BuildContext context) async {
  if (!url.contains("https")) {
    url = "https://$url";
  }
  final uri = Uri.parse(url.replaceAll(" ", ""));
  if (await canLaunchUrl(uri)) {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  } else {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('${getText('link_erro')}: $url')),
    );
  }
}

displayMessage(BuildContext context, String title, String message) async {
  if (!context.mounted) return;
  await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: Theme.of(context).primaryColor,
            foregroundColor: Colors.white,
          ),
          onPressed: () => Navigator.pop(c, true),
          child: const Text('OK'),
        ),
      ],
    ),
  );
}

displayMessageWithReturn(BuildContext context, String title, String message) async {
  if (!context.mounted) return null;
  return await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: Theme.of(context).primaryColor,
            foregroundColor: Colors.white,
          ),
          onPressed: () => Navigator.pop(c, true),
          child: const Text('OK'),
        ),
      ],
    ),
  );
}

showConfirmDialog(BuildContext context, {String? text}) async {
  return await showDialog<bool>(
    context: context,
    builder: (c) => Dialog(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
      ),
      backgroundColor: AppColors.surface(c),
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AppColors.primary.withOpacity(0.1),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    PhosphorIcons.question,
                    color: AppColors.primary,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 12),
                Text(
                  'Confirmação',
                  style: AppTypography.title(c).copyWith(
                    fontWeight: FontWeight.bold,
                    color: AppColors.textPrimary(c),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text(
              text ?? getText('alert_delete_description'),
              style: AppTypography.bodySecondary(c).copyWith(
                color: AppColors.textSecondary(c),
              ),
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      side: BorderSide(color: AppColors.border(c)),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    onPressed: () => Navigator.pop(c, false),
                    child: Text(
                      getText('alert_nao'),
                      style: AppTypography.bodyMedium(c).copyWith(
                        color: AppColors.textPrimary(c),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      backgroundColor: Colors.red,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    onPressed: () => Navigator.pop(c, true),
                    child: Text(
                      getText('alert_sim'),
                      style: AppTypography.bodyMedium(c).copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    ),
  );
}

showAlertEmBreve(BuildContext context) {
  showDialog(
    context: context,
    builder: (c) => AlertDialog(
      title: const Text("Em Breve"),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(c),
          child: const Text("OK"),
        ),
      ],
    ),
  );
}

validateDate(String date) {
  try {
    final format = DateFormat("dd/MM/yyyy");
    final birthDate = format.parseStrict(date);
    if (birthDate.year < 1920) return false;
    if (DateTime.now().difference(birthDate).inDays < 6570) return false;
    return true;
  } catch (e) {
    return false;
  }
}

validateGenericDate(String date) {
  try {
    DateFormat("dd/MM/yyyy").parseStrict(date);
    return true;
  } catch (e) {
    return false;
  }
}

convertStringToDateTime(String date) {
  try {
    return DateFormat("dd/MM/yyyy HH:mm").parseStrict(date).toString();
  } catch (e) {
    throw getText('invalid_data');
  }
}

convertStringToDateFormat(String date) {
  try {
    return DateFormat("dd/MM/yyyy").parseStrict(date);
  } catch (e) {
    return null;
  }
}

convertDateToString(String date) {
  try {
    return DateFormat("dd/MM/yyyy").format(DateTime.parse(date));
  } catch (e) {
    throw getText('invalid_data');
  }
}

convertStringToDateTimeFormat(String date) {
  try {
    return DateFormat("dd/MM/yyyy HH:mm").parseStrict(date);
  } catch (e) {
    return null;
  }
}

convertStringToDate(String date) {
  try {
    return DateFormat("dd/MM/yyyy").parseStrict(date).toString();
  } catch (e) {
    throw getText('invalid_data');
  }
}

convertStringToTime(String date) {
  try {
    return DateFormat("HH:mm").parseStrict(date).toString();
  } catch (e) {
    throw getText('invalid_hora');
  }
}

convertDateTimeToString(DateTime date) {
  try {
    return DateFormat('dd/MM/yyyy HH:mm').format(date);
  } catch (e) {
    return "";
  }
}

convertDateFormatToString(DateTime date) {
  try {
    return DateFormat('dd/MM/yyyy').format(date);
  } catch (e) {
    return "";
  }
}

convertTimeFormatToString(DateTime date) {
  try {
    return DateFormat('HH:mm').format(date);
  } catch (e) {
    return "";
  }
}

dateIsAfter(String date1, String date2) {
  try {
    final format = DateFormat("dd/MM/yyyy");
    return format.parseStrict(date2).isAfter(format.parseStrict(date1));
  } catch (e) {
    return false;
  }
}

validateFieldIsEmpty(String campo, String message) {
  if (campo.isEmpty) return "$message\n";
  return "";
}

getPhoto(BuildContext context) async {
  final exit = await showDialog<String>(
    context: context,
    builder: (c) => Dialog(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
      ),
      backgroundColor: AppColors.surface(c),
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AppColors.primary.withOpacity(0.1),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    PhosphorIcons.camera,
                    color: AppColors.primary,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 12),
                Text(
                  'Adicionar foto',
                  style: AppTypography.title(c).copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text(
              getText('alert_photo_choice'),
              style: AppTypography.bodySecondary(c),
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      side: BorderSide(color: AppColors.border(c)),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    onPressed: () => Navigator.pop(c, "camera"),
                    icon: Icon(
                      PhosphorIcons.camera,
                      color: AppColors.textPrimary(c),
                      size: 18,
                    ),
                    label: Text(
                      getText('alert_photo_camera'),
                      style: AppTypography.body(c).copyWith(
                        fontWeight: FontWeight.w600,
                        color: AppColors.textPrimary(c),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    onPressed: () => Navigator.pop(c, "galeria"),
                    icon: const Icon(
                      PhosphorIcons.image,
                      size: 18,
                      color: Colors.white,
                    ),
                    label: Text(
                      getText('alert_photo_galeria'),
                      style: AppTypography.body(c).copyWith(
                        fontWeight: FontWeight.w600,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    ),
  );
  return await pickImage(
      exit == "camera" ? ImageSource.camera : ImageSource.gallery);
}

pickImage(ImageSource type) async {
  try {
    final image = await ImagePicker.platform
        .pickImage(source: type, imageQuality: 50);
    return image;
  } catch (e) {
    return null;
  }
}

openWhatsApp(BuildContext context, String number, String text) {
  launchInBrowser(
    'https://api.whatsapp.com/send?phone=$number&text=$text',
    context,
  );
}

sendSMS(String number, String text) async {
  final uri = Uri.parse('sms:$number?body=$text');
  if (await canLaunchUrl(uri)) {
    await launchUrl(uri);
  }
}

openFile(String path) async {
  try {
    OpenFilex.open(path);
  } catch (e) {
    // falha silenciosa — arquivo pode não existir
  }
}

convertToBase64(dynamic file, String type) {
  if (file != null) {
    if (kIsWeb) {
      if (file is PlatformFile && file.bytes != null) {
        return 'data:$type;base64,' + base64Encode(file.bytes!);
      }
      return null;
    }
    String? path;
    if (file is String) {
      path = file;
    } else {
      try {
        path = file.path;
      } catch (e) {
        // Ignorar se não tiver a propriedade path
      }
    }
    if (path != null) {
      final imageBytes = File(path).readAsBytesSync();
      return 'data:$type;base64,' + base64Encode(imageBytes);
    }
  }
  return null;
}

Future<dynamic> fileFromImageUrl(String url) async {
  if (kIsWeb) return null;
  // Sem URL valida nao ha o que baixar. Sem essa guarda, um lancamento sem
  // comprovante (photo vazio) fazia http.get(Uri.parse('')) estourar, e a
  // tela de Despesa mostrava "Houve um erro" mesmo apos carregar os campos.
  final uri = Uri.tryParse(url);
  if (url.trim().isEmpty || uri == null || !uri.hasScheme) return null;
  try {
    await http.get(uri).timeout(_kHttpTimeout);
  } catch (_) {
    // Download do comprovante e best-effort; nunca deve quebrar o load.
    return null;
  }
  // (Escrita do arquivo local desativada — retornamos null de qualquer forma.)
  return null;
}

Future<dynamic> fileFromPdfUrl(String url) async {
  if (kIsWeb) return null;
  final uri = Uri.tryParse(url);
  if (url.trim().isEmpty || uri == null || !uri.hasScheme) return null;
  try {
    await http.get(uri).timeout(_kHttpTimeout);
  } catch (_) {
    return null;
  }
  return null;
}

Future<String> getAppVersion() async {
  final info = await PackageInfo.fromPlatform();
  return '${info.version} (${info.buildNumber})';
}
