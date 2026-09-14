import 'package:flutter/material.dart';

class LabelDefault extends StatelessWidget {
  final String title;
  final double? size;
  final Color? color;
  final FontWeight? weight;
  final int? maxLines;
  final TextAlign? align;
  final TextDecoration? decoration;
  final int? limitChars;

  const LabelDefault({
    super.key,
    required this.title,
    this.size, 
    this.color, 
    this.weight, 
    this.maxLines,
    this.align,
    this.decoration,
    this.limitChars
  });

  @override
  Widget build(BuildContext context) {   
    return Text(
        limitChars != null && title.length > limitChars! ? "${title.substring(0,limitChars)}..." : title,
        textAlign: align,
        maxLines: maxLines ?? 1,
        overflow: TextOverflow.ellipsis,
        textScaleFactor: 1.0,
        style: TextStyle(
          color: color ?? Theme.of(context).hintColor,
          fontSize: size ?? 17,
          fontWeight: weight ?? FontWeight.normal,
          decoration: decoration
        ),
      );
  }
}
