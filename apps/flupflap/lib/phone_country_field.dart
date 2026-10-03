import 'package:country_picker/country_picker.dart';
import 'package:flutter/material.dart';
import 'package:phone_numbers_parser/phone_numbers_parser.dart';
import 'country_flag.dart';
import 'parity_strings.dart';

/// Country names come from country_picker; dialing plans (including shared
/// calling codes and national prefixes) come from libphonenumber metadata.
class PhoneCountry {
  const PhoneCountry(this.iso, this.name);
  final IsoCode iso;
  final String name;
  String get code => iso.name;
  String get callingCode => PhoneNumber(isoCode: iso, nsn: '').countryCode;

  static final _names = CountryService();
  static final List<PhoneCountry> all = List.unmodifiable(
    IsoCode.values.map((iso) {
      final country = _names.findByCode(iso.name);
      // Tristan da Cunha is a separate dialing-plan region (+290) in
      // libphonenumber but is grouped under Saint Helena by country_picker.
      return PhoneCountry(
        iso,
        country?.name ?? (iso == IsoCode.TA ? 'Tristan da Cunha' : iso.name),
      );
    }).toList()..sort((a, b) => a.name.compareTo(b.name)),
  );

  static PhoneCountry? find(String? code) =>
      all.where((c) => c.code == code?.toUpperCase()).firstOrNull;

  static PhoneCountry fromLocales(Iterable<Locale> locales) {
    for (final locale in locales) {
      final country = find(locale.countryCode);
      if (country != null) return country;
    }
    return find('US')!;
  }

  static List<PhoneCountry> search(String query) {
    final q = query.trim().toLowerCase();
    final dial = q.replaceFirst(RegExp(r'^\+'), '');
    return all
        .where(
          (c) =>
              c.name.toLowerCase().contains(q) ||
              c.code.toLowerCase() == q ||
              c.callingCode.startsWith(dial),
        )
        .toList();
  }
}

class PhoneEntry {
  const PhoneEntry(this.country, this.number);
  final PhoneCountry country;
  final PhoneNumber? number;
  String get e164 => number?.international ?? '';
  static bool isInternational(String input) =>
      RegExp(r'^(\+|00)').hasMatch(input.trim());

  /// Parsing is deliberately separate from server validation. Incomplete or
  /// malformed input never becomes a different, apparently valid phone number.
  static PhoneEntry parse(String input, PhoneCountry selected) {
    final compact = input
        .replaceAll(RegExp(r'[\s().-]'), '')
        .replaceFirst(RegExp(r'^00'), '+');
    if (!RegExp(r'^\+?[0-9]+$').hasMatch(compact)) {
      return PhoneEntry(selected, null);
    }
    try {
      final explicit = compact.startsWith('+');
      var parsed = PhoneNumber.parse(
        compact,
        destinationCountry: explicit ? null : selected.iso,
      );
      if (explicit && !compact.startsWith('+${parsed.countryCode}')) {
        return PhoneEntry(selected, null);
      }
      // An area code can identify another NANP country even when the user has
      // only entered national digits. Never infer US from the +1 prefix alone.
      final inferred = PhoneNumber.parse(parsed.international);
      final preferred = PhoneNumber(isoCode: selected.iso, nsn: parsed.nsn);
      if (preferred.countryCode == parsed.countryCode &&
          (preferred.isValid() || !inferred.isValid())) {
        parsed = preferred;
      } else if (inferred.isValid()) {
        parsed = inferred;
      }
      return PhoneEntry(PhoneCountry.find(parsed.isoCode.name)!, parsed);
    } on Exception {
      return PhoneEntry(selected, null);
    }
  }

  String requireE164() {
    if (number == null ||
        !number!.isValid() ||
        !RegExp(r'^\+[1-9][0-9]{6,14}$').hasMatch(number!.international)) {
      throw const FormatException('Invalid phone number');
    }
    return number!.international;
  }
}

/// Shared by registration, saved recipients and recharge. Consumers receive an
/// international number. Complete international input is displayed nationally
/// so the calling code appears only once, in the picker.
class PhoneCountryField extends StatefulWidget {
  const PhoneCountryField({
    super.key,
    required this.controller,
    required this.onChanged,
    this.countryCode,
    this.enabled = true,
    this.fieldKey,
    this.onSubmitted,
    this.textInputAction = TextInputAction.next,
    this.showCountryName = false,
    this.errorText,
  });
  final TextEditingController controller;
  final ValueChanged<PhoneEntry> onChanged;
  final String? countryCode;
  final bool enabled;
  final Key? fieldKey;
  final VoidCallback? onSubmitted;
  final TextInputAction textInputAction;
  final bool showCountryName;
  final String? errorText;
  @override
  State<PhoneCountryField> createState() => _PhoneCountryFieldState();
}

class _PhoneCountryFieldState extends State<PhoneCountryField> {
  PhoneCountry? _country;
  PhoneCountry get country => _country!;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(controllerChanged);
  }

  void controllerChanged() {
    if (!PhoneEntry.isInternational(widget.controller.text)) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !PhoneEntry.isInternational(widget.controller.text)) {
        return;
      }
      setState(syncInternationalDisplay);
    });
  }

  @override
  void dispose() {
    widget.controller.removeListener(controllerChanged);
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _country ??=
        PhoneCountry.find(widget.countryCode) ??
        PhoneCountry.fromLocales(View.of(context).platformDispatcher.locales);
    syncInternationalDisplay();
  }

  @override
  void didUpdateWidget(covariant PhoneCountryField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(controllerChanged);
      widget.controller.addListener(controllerChanged);
    }
    if (oldWidget.countryCode != widget.countryCode) {
      _country =
          PhoneCountry.find(widget.countryCode) ??
          PhoneCountry.fromLocales(View.of(context).platformDispatcher.locales);
    }
    syncInternationalDisplay();
  }

  // A restored journey or saved recipient already holds E.164. Display its
  // national part without notifying the parent or invalidating its saved ID.
  void syncInternationalDisplay() {
    if (!PhoneEntry.isInternational(widget.controller.text)) return;
    final entry = PhoneEntry.parse(widget.controller.text, country);
    _country = entry.country;
    displayNational(entry);
  }

  void displayNational(PhoneEntry entry) {
    if (entry.number?.isValidLength() != true) return;
    final national = entry.number!.nsn;
    widget.controller.value = TextEditingValue(
      text: national,
      selection: TextSelection.collapsed(offset: national.length),
    );
  }

  void changed(String value) {
    final entry = PhoneEntry.parse(value, country);
    if (PhoneEntry.isInternational(value)) displayNational(entry);
    setState(() => _country = entry.country);
    widget.onChanged(entry);
  }

  Future<void> chooseCountry() async {
    final selected = await showModalBottomSheet<PhoneCountry>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => const _PhoneCountryPicker(),
    );
    if (!mounted || !widget.enabled || selected == null) return;
    // Preserve national digits when replacing a previously explicit prefix.
    // A country switch must never turn +509... into +33509... .
    if (PhoneEntry.isInternational(widget.controller.text)) {
      final national = PhoneEntry.parse(
        widget.controller.text,
        country,
      ).number?.nsn;
      if (national != null) {
        widget.controller.value = TextEditingValue(
          text: national,
          selection: TextSelection.collapsed(offset: national.length),
        );
      }
    }
    setState(() => _country = selected);
    changed(widget.controller.text);
  }

  @override
  Widget build(BuildContext context) {
    final picker = Tooltip(
      message: '${country.name} (${country.code}) +${country.callingCode}',
      child: OutlinedButton(
        key: const ValueKey('phone-country-picker'),
        onPressed: widget.enabled ? chooseCountry : null,
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        ),
        child: Row(
          mainAxisSize: widget.showCountryName
              ? MainAxisSize.max
              : MainAxisSize.min,
          children: [
            CountryFlag(country.code),
            const SizedBox(width: 8),
            if (widget.showCountryName) ...[
              Expanded(
                child: Text(
                  country.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 8),
            ],
            Text('+${country.callingCode}'),
            const Icon(Icons.arrow_drop_down, size: 18),
          ],
        ),
      ),
    );
    final input = TextField(
      key: widget.fieldKey,
      controller: widget.controller,
      enabled: widget.enabled,
      keyboardType: TextInputType.phone,
      textInputAction: widget.textInputAction,
      autofillHints: const [AutofillHints.telephoneNumber],
      decoration: InputDecoration(
        labelText: context.ft('Phone number'),
        errorText: widget.errorText,
        errorMaxLines: 3,
        helperText: widget.showCountryName
            ? context.ft('nationalPhoneHelp')
            : null,
        helperMaxLines: 3,
      ),
      onChanged: changed,
      onSubmitted: (_) => widget.onSubmitted?.call(),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(context.ft('country')),
        const SizedBox(height: 8),
        if (widget.showCountryName) ...[
          picker,
          const SizedBox(height: 10),
          input,
        ] else
          Row(
            children: [
              picker,
              const SizedBox(width: 8),
              Expanded(child: input),
            ],
          ),
        if (!widget.showCountryName) ...[
          const SizedBox(height: 4),
          Text(
            '${country.name} (${country.code})',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ],
    );
  }
}

class _PhoneCountryPicker extends StatefulWidget {
  const _PhoneCountryPicker();
  @override
  State<_PhoneCountryPicker> createState() => _PhoneCountryPickerState();
}

class _PhoneCountryPickerState extends State<_PhoneCountryPicker> {
  String query = '';
  @override
  Widget build(BuildContext context) {
    final countries = PhoneCountry.search(query);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * .65,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: TextField(
                key: const ValueKey('phone-country-search'),
                autofocus: true,
                decoration: InputDecoration(
                  labelText: context.ft('search'),
                  prefixIcon: const Icon(Icons.search),
                ),
                onChanged: (value) => setState(() => query = value),
              ),
            ),
            Expanded(
              child: ListView.builder(
                itemCount: countries.length,
                itemBuilder: (context, i) {
                  final country = countries[i];
                  return ListTile(
                    key: ValueKey('phone-country-${country.code}'),
                    leading: CountryFlag(country.code),
                    title: Text(country.name),
                    subtitle: Text('${country.code} · +${country.callingCode}'),
                    onTap: () => Navigator.pop(context, country),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
