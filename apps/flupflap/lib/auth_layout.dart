import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:ticash/localization/app_localizations.dart';

/// Presentation only: authentication, guest access, and registration stay in
/// AuthScreen. The scroll viewport shrinks naturally when the keyboard opens.
class AuthLayout extends StatelessWidget {
  const AuthLayout({
    super.key,
    required this.logo,
    required this.child,
    required this.signIn,
    required this.language,
    this.onLanguage,
  });

  final Widget logo, child;
  final bool signIn;
  final AppLanguage language;
  final ValueChanged<AppLanguage>? onLanguage;

  @override
  Widget build(BuildContext context) {
    const blue = Color(0xFF0768ED);
    final narrow = MediaQuery.sizeOf(context).width < 350;
    final radius = BorderRadius.circular(18);
    final theme = Theme.of(context);
    final border = OutlineInputBorder(
      borderRadius: radius,
      borderSide: const BorderSide(color: Color(0xFFDDE3EE)),
    );
    return Theme(
      data: theme.copyWith(
        inputDecorationTheme: theme.inputDecorationTheme.copyWith(
          filled: true,
          fillColor: const Color(0xFFFCFDFF),
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 18,
          ),
          border: border,
          enabledBorder: border,
          focusedBorder: border.copyWith(
            borderSide: const BorderSide(color: blue, width: 1.5),
          ),
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            backgroundColor: blue,
            foregroundColor: Colors.white,
            minimumSize: const Size.fromHeight(56),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            shape: RoundedRectangleBorder(borderRadius: radius),
            textStyle: const TextStyle(
              fontFamily: 'Roboto',
              fontSize: 17,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        outlinedButtonTheme: OutlinedButtonThemeData(
          style: OutlinedButton.styleFrom(
            foregroundColor: blue,
            backgroundColor: Colors.white,
            minimumSize: const Size.fromHeight(54),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
            side: const BorderSide(color: blue, width: 1.3),
            shape: RoundedRectangleBorder(borderRadius: radius),
            textStyle: const TextStyle(
              fontFamily: 'Roboto',
              fontSize: 16,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        textButtonTheme: TextButtonThemeData(
          style: TextButton.styleFrom(
            foregroundColor: blue,
            minimumSize: const Size(48, 48),
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 12),
            textStyle: const TextStyle(
              fontFamily: 'Roboto',
              fontSize: 15,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      ),
      child: AnnotatedRegion<SystemUiOverlayStyle>(
        value: const SystemUiOverlayStyle(
          statusBarColor: Colors.white,
          statusBarIconBrightness: Brightness.dark,
          statusBarBrightness: Brightness.light,
          systemNavigationBarColor: Colors.white,
          systemNavigationBarIconBrightness: Brightness.dark,
        ),
        child: Scaffold(
          backgroundColor: Colors.white,
          body: Stack(
            children: [
              if (signIn)
                const Positioned.fill(
                  child: IgnorePointer(
                    child: CustomPaint(painter: _AuthBackdrop()),
                  ),
                ),
              SafeArea(
                child: LayoutBuilder(
                  builder: (context, viewport) {
                    final padding = narrow ? 16.0 : 20.0;
                    return SingleChildScrollView(
                      keyboardDismissBehavior:
                          ScrollViewKeyboardDismissBehavior.onDrag,
                      padding: EdgeInsets.all(padding),
                      child: ConstrainedBox(
                        constraints: BoxConstraints(
                          minHeight: (viewport.maxHeight - padding * 2).clamp(
                            0,
                            double.infinity,
                          ),
                        ),
                        child: Center(
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 460),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                if (onLanguage != null) ...[
                                  Align(
                                    alignment: Alignment.centerRight,
                                    child: Container(
                                      width: 188,
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 12,
                                      ),
                                      decoration: BoxDecoration(
                                        color: Colors.white,
                                        border: Border.all(
                                          color: const Color(0xFFE1E6EF),
                                        ),
                                        borderRadius: BorderRadius.circular(16),
                                      ),
                                      child: DropdownButtonHideUnderline(
                                        child: DropdownButton<AppLanguage>(
                                          value: language,
                                          isExpanded: true,
                                          icon: const Icon(Icons.expand_more),
                                          items: AppLanguage.values
                                              .map(
                                                (l) => DropdownMenuItem(
                                                  value: l,
                                                  child: Text(
                                                    l.nativeName,
                                                    maxLines: 1,
                                                    overflow:
                                                        TextOverflow.ellipsis,
                                                  ),
                                                ),
                                              )
                                              .toList(),
                                          onChanged: (v) {
                                            if (v != null) onLanguage!(v);
                                          },
                                        ),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(height: 16),
                                ],
                                logo,
                                SizedBox(height: signIn ? 24 : 16),
                                Card(
                                  key: const ValueKey('auth-card'),
                                  margin: EdgeInsets.zero,
                                  color: Colors.white,
                                  elevation: 0,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(26),
                                    side: const BorderSide(
                                      color: Color(0xFFE9EDF6),
                                    ),
                                  ),
                                  child: Padding(
                                    padding: EdgeInsets.all(narrow ? 16 : 24),
                                    child: child,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AuthBackdrop extends CustomPainter {
  const _AuthBackdrop();
  @override
  void paint(Canvas canvas, Size size) {
    final bounds = Offset.zero & size;
    final paint = Paint()
      ..shader = const LinearGradient(
        colors: [Color(0xFFEAF8FF), Color(0xFFF4EEFF)],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ).createShader(bounds);
    canvas.drawPath(
      Path()
        ..moveTo(0, size.height * .06)
        ..cubicTo(
          size.width * .48,
          size.height * .07,
          size.width * .25,
          size.height * .45,
          size.width,
          size.height * .25,
        )
        ..lineTo(size.width, size.height * .5)
        ..cubicTo(
          size.width * .36,
          size.height * .55,
          size.width * .3,
          size.height * .3,
          0,
          size.height * .3,
        )
        ..close(),
      paint,
    );
    canvas.drawPath(
      Path()
        ..moveTo(0, size.height * .89)
        ..cubicTo(
          size.width * .55,
          size.height * .9,
          size.width * .5,
          size.height * 1.05,
          size.width,
          size.height * .87,
        )
        ..lineTo(size.width, size.height)
        ..lineTo(0, size.height)
        ..close(),
      paint,
    );
  }

  @override
  bool shouldRepaint(_AuthBackdrop oldDelegate) => false;
}
