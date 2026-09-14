import 'package:flutter/material.dart';

class DefaultButtonNormal extends StatelessWidget {
  final String title;
  final VoidCallback? onPressed;
  final bool hasArrow;
  final FractionalOffset? aligment;
  final bool? isRed;

  const DefaultButtonNormal({
    super.key,
    required this.title,
    this.onPressed,
    required this.hasArrow,
    this.aligment, 
    this.isRed
  });

  @override
  Widget build(BuildContext context) {
    ThemeData theme = Theme.of(context);

    return       
      ElevatedButton(
        onPressed: onPressed,
        style: ElevatedButton.styleFrom(
          padding: const EdgeInsets.all(0.0),
          elevation: 5,
          minimumSize: Size(double.infinity, 30),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        ),
        child: Ink(
          height: 50,
          width: MediaQuery.of(context).size.width,
          decoration: BoxDecoration(
            gradient: LinearGradient(
                colors: isRed == null || isRed == false ?
                        [Color.fromRGBO(43, 196, 243, 1), Color.fromRGBO(0, 174, 238, 1),
                              Color.fromRGBO(0, 149, 218, 1)]
                        : [Color.fromRGBO(255, 157, 144, 1), Color.fromRGBO(206, 1, 1, 0.8)],
                begin: Alignment.centerLeft,
                end: Alignment.centerRight
            ),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Container(          
            padding: const EdgeInsets.all(12),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  title,
                  textAlign: TextAlign.center,
                  style: theme.textTheme.titleLarge?.merge(
                    TextStyle(color: Colors.white),
                  ),
                ),
                SizedBox(width: 10),
                if(hasArrow)
                  Icon(Icons.arrow_right_alt, size: 40,)
              ]
            )
          ),
        )
      );
  }
}
