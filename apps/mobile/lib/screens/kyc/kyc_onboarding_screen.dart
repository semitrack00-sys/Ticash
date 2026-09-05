import 'package:didit_sdk_autodetection/sdk_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../config/theme.dart';
import '../../localization/app_localizations.dart';
import '../../models/user.dart';
import '../../providers/auth_provider.dart';
import '../../services/kyc_service.dart';
import '../../widgets/app_navigation_bar.dart';
import '../../widgets/primary_button.dart';

class KycOnboardingScreen extends ConsumerStatefulWidget {
  const KycOnboardingScreen({super.key});

  @override
  ConsumerState<KycOnboardingScreen> createState() =>
      _KycOnboardingScreenState();
}

class _KycOnboardingScreenState extends ConsumerState<KycOnboardingScreen> {
  final KycService _service = KycService();
  bool _busy = false;
  String? _error;

  Future<void> _startVerification() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final session = await _service.createSession();
      if (!mounted) return;
      final languageCode = context.appLanguage.materialLocale.languageCode;
      await DiditSdk.startVerification(
        session.sessionToken,
        config: DiditConfig(languageCode: languageCode, loggingEnabled: false),
      );
      if (!mounted) return;
      // The SDK result is intentionally not used to grant access. The backend
      // reconciles with Didit and remains the sole authority for KYC status.
      await _refreshStatus(reconcile: true, showBusy: false);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _refreshStatus({
    bool reconcile = true,
    bool showBusy = true,
  }) async {
    if (_busy && showBusy) return;
    if (showBusy) {
      setState(() {
        _busy = true;
        _error = null;
      });
    }
    try {
      await _service.getStatus(refresh: reconcile);
      await ref.read(authNotifierProvider.notifier).refreshCurrentUser();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted && showBusy) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final status =
        ref.watch(authNotifierProvider).valueOrNull?.kycStatus ??
        KycStatus.notStarted;
    final presentation = _presentation(context, status);
    final canStart =
        status != KycStatus.approved && status != KycStatus.inReview;

    return Scaffold(
      appBar: AppNavigationBar(title: context.tr('identityVerification')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 24, 20, 32),
          children: [
            Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 560),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          children: [
                            CircleAvatar(
                              radius: 34,
                              backgroundColor: presentation.color.withValues(
                                alpha: 0.12,
                              ),
                              child: Icon(
                                presentation.icon,
                                size: 36,
                                color: presentation.color,
                              ),
                            ),
                            const SizedBox(height: 18),
                            Text(
                              presentation.title,
                              textAlign: TextAlign.center,
                              style: Theme.of(context).textTheme.headlineSmall
                                  ?.copyWith(fontWeight: FontWeight.w900),
                            ),
                            const SizedBox(height: 10),
                            Text(
                              presentation.body,
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: AppTheme.muted,
                                height: 1.45,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(20),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              context.tr('beforeVerification'),
                              style: const TextStyle(
                                fontWeight: FontWeight.w900,
                                fontSize: 17,
                              ),
                            ),
                            const SizedBox(height: 14),
                            _Requirement(
                              icon: Icons.badge_outlined,
                              text: context.tr('governmentIdRequired'),
                            ),
                            _Requirement(
                              icon: Icons.camera_alt_outlined,
                              text: context.tr('cameraRequired'),
                            ),
                            _Requirement(
                              icon: Icons.light_mode_outlined,
                              text: context.tr('goodLightingRequired'),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      context.tr('diditDisclosure'),
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: AppTheme.muted,
                        fontSize: 12,
                        height: 1.45,
                      ),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 14),
                      Text(
                        _error!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: AppTheme.error),
                      ),
                    ],
                    const SizedBox(height: 18),
                    if (canStart)
                      PrimaryButton(
                        label: status == KycStatus.pending
                            ? context.tr('continueVerification')
                            : context.tr('startVerification'),
                        icon: Icons.verified_user_outlined,
                        isLoading: _busy,
                        onPressed: _startVerification,
                      ),
                    if (status == KycStatus.pending ||
                        status == KycStatus.inReview) ...[
                      OutlinedButton.icon(
                        onPressed: _busy ? null : _refreshStatus,
                        icon: const Icon(Icons.refresh),
                        label: Text(context.tr('checkVerificationStatus')),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  _KycPresentation _presentation(BuildContext context, KycStatus status) {
    return switch (status) {
      KycStatus.notStarted => _KycPresentation(
        Icons.verified_user_outlined,
        AppTheme.gold,
        context.tr('verifyYourIdentity'),
        context.tr('verifyIdentityBody'),
      ),
      KycStatus.pending => _KycPresentation(
        Icons.schedule,
        AppTheme.gold,
        context.tr('verificationStarted'),
        context.tr('verificationStartedBody'),
      ),
      KycStatus.inReview => _KycPresentation(
        Icons.manage_search,
        AppTheme.gold,
        context.tr('verificationInReview'),
        context.tr('verificationInReviewBody'),
      ),
      KycStatus.approved => _KycPresentation(
        Icons.verified,
        AppTheme.success,
        context.tr('verificationApproved'),
        context.tr('verificationApprovedBody'),
      ),
      KycStatus.declined => _KycPresentation(
        Icons.error_outline,
        AppTheme.error,
        context.tr('verificationDeclined'),
        context.tr('verificationDeclinedBody'),
      ),
      KycStatus.expired => _KycPresentation(
        Icons.timer_off_outlined,
        AppTheme.error,
        context.tr('verificationExpired'),
        context.tr('verificationExpiredBody'),
      ),
    };
  }
}

class _Requirement extends StatelessWidget {
  const _Requirement({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Row(
      children: [
        Icon(icon, color: AppTheme.navy),
        const SizedBox(width: 12),
        Expanded(child: Text(text)),
      ],
    ),
  );
}

class _KycPresentation {
  const _KycPresentation(this.icon, this.color, this.title, this.body);

  final IconData icon;
  final Color color;
  final String title;
  final String body;
}
