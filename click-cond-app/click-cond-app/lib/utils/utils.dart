import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:file_picker/file_picker.dart';
import 'package:click/utils/localizable/localizable.dart';
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
    builder: (c) => AlertDialog(
      title: Text(text ?? getText('alert_delete_description')),
      actions: [
        ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.red,
            foregroundColor: Colors.white,
          ),
          onPressed: () => Navigator.pop(c, true),
          child: Text(getText('alert_sim')),
        ),
        ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.white,
            foregroundColor: Theme.of(context).primaryColor,
          ),
          onPressed: () => Navigator.pop(c, false),
          child: Text(
            getText('alert_nao'),
            style: TextStyle(color: Theme.of(context).primaryColor),
          ),
        ),
      ],
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
    builder: (c) => AlertDialog(
      title: Text(getText('alert_photo_choice'), textScaleFactor: 1.0),
      actions: [
        ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.white,
            foregroundColor: Theme.of(context).primaryColor,
          ),
          onPressed: () => Navigator.pop(c, "camera"),
          child: Text(
            getText('alert_photo_camera'),
            textScaleFactor: 1.0,
            style: TextStyle(color: Theme.of(context).primaryColor),
          ),
        ),
        ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: Theme.of(context).primaryColor,
            foregroundColor: Colors.white,
          ),
          onPressed: () => Navigator.pop(c, "galeria"),
          child: Text(getText('alert_photo_galeria'), textScaleFactor: 1.0),
        ),
      ],
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
  final response = await http.get(Uri.parse(url)).timeout(_kHttpTimeout);
  final documentDirectory = await getApplicationDocumentsDirectory();
  // ignore: undefined_class
  // final file = null.millisecondsSinceEpoch}.png'));
  // file.writeAsBytesSync(response.bodyBytes);
  return null;
}

Future<dynamic> fileFromPdfUrl(String url) async {
  if (kIsWeb) return null;
  final response = await http.get(Uri.parse(url)).timeout(_kHttpTimeout);
  final documentDirectory = await getApplicationDocumentsDirectory();
  return null;
}

Future<String> getAppVersion() async {
  final info = await PackageInfo.fromPlatform();
  return '${info.version} (${info.buildNumber})';
}
