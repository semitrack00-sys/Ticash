import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/mobile_topup.dart';
import '../providers/mobile_topup_provider.dart';
import '../theme/app_colors.dart';
import '../theme/app_text_styles.dart';

class MobileTopUpScreen extends ConsumerStatefulWidget {
  const MobileTopUpScreen({super.key});

  @override
  ConsumerState<MobileTopUpScreen> createState() => _MobileTopUpScreenState();
}

class _MobileTopUpScreenState extends ConsumerState<MobileTopUpScreen> {
  late final TextEditingController _phoneController;

  @override
  void initState() {
    super.initState();
    _phoneController = TextEditingController();
  }

  @override
  void dispose() {
    _phoneController.dispose();
    super.dispose();
  }

  Future<void> _pickCountry(
    BuildContext context,
    List<MobileTopUpCountry> countries,
  ) async {
    var query = '';
    final selected = await showDialog<MobileTopUpCountry>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) {
          final filtered = countries
              .where((country) =>
                  country.name.toLowerCase().contains(query.toLowerCase()) ||
                  country.code.toLowerCase().contains(query.toLowerCase()))
              .toList();
          return AlertDialog(
            backgroundColor: AppColors.surface,
            title: const Text('Select destination country', style: AppTextStyles.subheading),
            content: SizedBox(
              width: 360,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    autofocus: true,
                    style: AppTextStyles.body,
                    decoration: const InputDecoration(
                      hintText: 'Search countries',
                    ),
                    onChanged: (value) => setState(() => query = value),
                  ),
                  const SizedBox(height: 12),
                  Flexible(
                    child: ListView.builder(
                      shrinkWrap: true,
                      itemCount: filtered.length,
                      itemBuilder: (context, index) {
                        final country = filtered[index];
                        return ListTile(
                          title: Text(country.name, style: AppTextStyles.body),
                          subtitle: Text(country.code, style: AppTextStyles.small),
                          onTap: () => Navigator.of(context).pop(country),
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
    if (selected != null && mounted) {
      ref.read(mobileTopUpControllerProvider.notifier).selectCountry(selected);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(mobileTopUpControllerProvider);
    final controller = ref.read(mobileTopUpControllerProvider.notifier);
    if (_phoneController.text != state.phone) {
      _phoneController.value = TextEditingValue(
        text: state.phone,
        selection: TextSelection.collapsed(offset: state.phone.length),
      );
    }

    return Scaffold(
      backgroundColor: AppColors.primaryDark,
      appBar: AppBar(
        backgroundColor: AppColors.primaryDark,
        title: const Text('Mobile recharge'),
      ),
      body: state.loading && state.countries.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: const Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Sandbox only • USD billing', style: AppTextStyles.subheading),
                      SizedBox(height: 8),
                      Text(
                        'Provider-supported countries only. Production recharge and live payments stay disabled.',
                        style: AppTextStyles.small,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
                if (state.savedRecipients.isNotEmpty) ...[
                  const Text('Saved recipients', style: AppTextStyles.subheading),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: state.savedRecipients
                        .map(
                          (recipient) => ActionChip(
                            label: Text('${recipient.nickname} • ${recipient.countryCode}'),
                            onPressed: () => controller.loadRecipient(recipient),
                          ),
                        )
                        .toList(),
                  ),
                  const SizedBox(height: 20),
                ],
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: state.countries.isEmpty
                            ? null
                            : () => _pickCountry(context, state.countries),
                        child: Text(
                          state.selectedCountry == null
                              ? 'Select destination country'
                              : '${state.selectedCountry!.name} (${state.selectedCountry!.code})',
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _phoneController,
                  style: AppTextStyles.body,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(
                    labelText: 'International mobile number',
                    hintText: '+1 876 555 1234',
                  ),
                  onChanged: controller.updatePhone,
                ),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: state.loading ? null : controller.detectOperator,
                  child: const Text('Detect operator'),
                ),
                if (state.error != null) ...[
                  const SizedBox(height: 12),
                  Text(state.error!, style: const TextStyle(color: AppColors.error)),
                ],
                if (state.operator != null) ...[
                  const SizedBox(height: 20),
                  Text('Operator', style: AppTextStyles.subheading),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(state.operator!.name, style: AppTextStyles.body),
                        const SizedBox(height: 4),
                        Text(
                          '${state.operator!.countryCode} • ${state.operator!.destinationCurrencyCode}',
                          style: AppTextStyles.small,
                        ),
                      ],
                    ),
                  ),
                ],
                if (state.products.isNotEmpty) ...[
                  const SizedBox(height: 20),
                  const Text('Products', style: AppTextStyles.subheading),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: state.products
                        .map(
                          (product) => ChoiceChip(
                            label: Text(
                              '${product.name}\n${product.priceCurrency} ${product.price.toStringAsFixed(2)}',
                              textAlign: TextAlign.center,
                            ),
                            selected: state.selectedProduct?.id == product.id,
                            onSelected: (_) => controller.selectProduct(product),
                          ),
                        )
                        .toList(),
                  ),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: state.submitting ? null : controller.requestQuote,
                    child: const Text('Get quote'),
                  ),
                ],
                if (state.quote != null) ...[
                  const SizedBox(height: 20),
                  const Text('Review', style: AppTextStyles.subheading),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${state.quote!.countryCode} • ${state.quote!.operatorName}',
                          style: AppTextStyles.body,
                        ),
                        const SizedBox(height: 4),
                        Text(state.quote!.productName, style: AppTextStyles.small),
                        const SizedBox(height: 4),
                        Text(
                          'Charge: USD ${state.quote!.totalChargeUsd.toStringAsFixed(2)}',
                          style: AppTextStyles.body,
                        ),
                        const SizedBox(height: 12),
                        FilledButton(
                          onPressed: state.submitting ? null : controller.purchase,
                          child: const Text('Confirm recharge'),
                        ),
                      ],
                    ),
                  ),
                ],
                if (state.receipt != null) ...[
                  const SizedBox(height: 20),
                  const Text('Receipt', style: AppTextStyles.subheading),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${state.receipt!.countryCode} • ${state.receipt!.operatorName}',
                          style: AppTextStyles.body,
                        ),
                        const SizedBox(height: 4),
                        Text(state.receipt!.productName, style: AppTextStyles.small),
                        const SizedBox(height: 4),
                        Text('Status: ${state.receipt!.status}', style: AppTextStyles.body),
                      ],
                    ),
                  ),
                ],
                if (state.history.isNotEmpty) ...[
                  const SizedBox(height: 20),
                  const Text('Recent recharge history', style: AppTextStyles.subheading),
                  const SizedBox(height: 8),
                  ...state.history.map(
                    (transaction) => ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        '${transaction.countryCode} • ${transaction.operatorName}',
                        style: AppTextStyles.body,
                      ),
                      subtitle: Text(transaction.productName, style: AppTextStyles.small),
                      trailing: Text(transaction.status, style: AppTextStyles.small),
                    ),
                  ),
                ],
              ],
            ),
    );
  }
}
