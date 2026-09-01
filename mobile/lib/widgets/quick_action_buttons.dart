import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../theme/app_colors.dart';
import '../theme/app_text_styles.dart';

/// A single action, e.g. "Send money" or "Add money".
class QuickAction {
  const QuickAction({required this.label, required this.icon, required this.onTap});

  final String label;
  final IconData icon;
  final VoidCallback onTap;
}

/// Row of quick-action buttons: "Send money", "Add money", "My QR",
/// styled as teal/white pills matching the mockup.
class QuickActionButtons extends StatelessWidget {
  const QuickActionButtons({
    super.key,
    required this.onSendMoney,
    required this.onAddMoney,
    required this.onMyQr,
  });

  final VoidCallback onSendMoney;
  final VoidCallback onAddMoney;
  final VoidCallback onMyQr;

  @override
  Widget build(BuildContext context) {
    final actions = [
      QuickAction(label: 'Send money', icon: Icons.arrow_upward_rounded, onTap: onSendMoney),
      QuickAction(label: 'Add money', icon: Icons.add_rounded, onTap: onAddMoney),
      QuickAction(label: 'My QR', icon: Icons.qr_code_rounded, onTap: onMyQr),
    ];

    return Row(
      children: [
        for (final action in actions) ...[
          Expanded(child: _QuickActionButton(action: action)),
          if (action != actions.last) const SizedBox(width: 12),
        ],
      ],
    );
  }
}

class _QuickActionButton extends StatelessWidget {
  const _QuickActionButton({required this.action});

  final QuickAction action;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.secondary,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: action.onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 14),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(action.icon, color: AppColors.primaryDark),
              const SizedBox(height: 6),
              Text(
                action.label,
                textAlign: TextAlign.center,
                style: AppTextStyles.small.copyWith(
                  color: AppColors.primaryDark,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    ).animate().fadeIn(duration: 300.ms).scale(begin: const Offset(0.95, 0.95));
  }
}
