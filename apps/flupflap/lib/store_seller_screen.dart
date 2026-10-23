import 'dart:async';
import 'package:country_picker/country_picker.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'session.dart';
import 'flupflap_page_title.dart';
import 'internet_bundle_card.dart';
import 'package:ticash_recharge_core/models/mobile_top_up.dart';

class StoreSellerScreen extends StatefulWidget {
  const StoreSellerScreen({super.key, required this.session});
  final FlupFlapSession session;
  @override
  State<StoreSellerScreen> createState() => _StoreSellerScreenState();
}

class _StoreSellerScreenState extends State<StoreSellerScreen> {
  final fields = List.generate(8, (_) => TextEditingController());
  final form = GlobalKey<FormState>();
  Map<String, dynamic>? data, quote, transaction;
  List<Map<String, dynamic>> products = [];
  Map<String, dynamic>? product;
  String country = 'US', destination = 'HT';
  String? error, owner;
  bool busy = false, uncertain = false;
  Timer? timer;
  Dio get dio => widget.session.dio;
  bool get alive =>
      mounted &&
      widget.session.authenticated &&
      widget.session.user?['id'] == owner;
  String money(dynamic cents) =>
      '\$${((cents as num? ?? 0) / 100).toStringAsFixed(2)}';

  @override
  void initState() {
    super.initState();
    owner = widget.session.user?['id'] as String?;
    refresh();
  }

  @override
  void dispose() {
    timer?.cancel();
    for (final field in fields) {
      field.dispose();
    }
    super.dispose();
  }

  Future<void> run(Future<void> Function() action) async {
    if (busy || !alive) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await action();
    } on DioException catch (e) {
      if (alive) {
        final code = e.response?.data is Map ? e.response?.data['code'] : null;
        if ([
          'STORE_INSUFFICIENT_BALANCE',
          'STORE_NOT_ACTIVE',
          'TOPUP_QUOTE_EXPIRED',
          'TOPUP_QUOTE_CHANGED',
        ].contains(code)) {
          uncertain = false;
        }
        setState(() {
          error = switch (code) {
            'STORE_INSUFFICIENT_BALANCE' =>
              'Your store balance is too low. Add funds, then retry this sale.',
            'STORE_NOT_ACTIVE' =>
              'Your store needs approval before selling or adding funds.',
            'STORE_UNAVAILABLE' =>
              'Store seller accounts are not available yet.',
            'DEPOSIT_REFERENCE_ALREADY_USED' =>
              'This deposit reference has already been used.',
            'TOPUP_QUOTE_EXPIRED' => 'This price expired. Start a new quote.',
            _ =>
              'We could not confirm the request. Refresh before trying again.',
          };
        });
      }
    } catch (_) {
      if (alive) {
        setState(() {
          error = 'Unable to complete this request. Refresh and try again.';
        });
      }
    } finally {
      if (alive) {
        setState(() {
          busy = false;
        });
      }
    }
  }

  Future<void> load() async {
    final response = await dio.get('/flupflap/stores');
    if (alive) {
      setState(() {
        data = Map<String, dynamic>.from(response.data as Map);
      });
    }
  }

  Future<void> refresh() => run(load);
  void pickCountry(bool store) {
    showCountryPicker(
      context: context,
      countryFilter: store
          ? (data?['registrationCountries'] as List?)?.cast<String>()
          : null,
      onSelect: (value) {
        if (alive) {
          setState(() {
            if (store) {
              country = value.countryCode;
            } else {
              destination = value.countryCode;
              products = [];
              product = null;
            }
          });
        }
      },
    );
  }

  Widget input(
    int index,
    String label, {
    bool number = false,
    bool enabled = true,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: TextFormField(
      controller: fields[index],
      enabled: enabled && !busy,
      keyboardType: number
          ? const TextInputType.numberWithOptions(decimal: true)
          : TextInputType.text,
      decoration: InputDecoration(
        labelText: label,
        border: const OutlineInputBorder(),
      ),
      validator: (value) =>
          value == null || value.trim().isEmpty ? 'Required' : null,
    ),
  );
  Widget countryButton(bool store) {
    final code = store ? country : destination;
    final name = CountryService().findByCode(code)?.name ?? code;
    return OutlinedButton.icon(
      onPressed: busy ? null : () => pickCountry(store),
      icon: const Icon(Icons.public),
      label: Text('${store ? 'Store country' : 'Recipient country'}: $name'),
    );
  }

  Future<void> apply() => run(() async {
    if (!form.currentState!.validate()) return;
    await dio.post(
      '/flupflap/stores/application',
      data: {
        'name': fields[0].text.trim(),
        'contactName': fields[1].text.trim(),
        'phone': fields[2].text.trim(),
        'address': fields[3].text.trim(),
        'country': country,
      },
    );
    await load();
  });
  Future<void> findProducts() => run(() async {
    final detected = await dio.get(
      '/flupflap/mobile-topups/operators/detect',
      queryParameters: {'country': destination, 'phone': fields[4].text.trim()},
    );
    final operator = Map<String, dynamic>.from(
      detected.data['operator'] as Map,
    );
    final response = await dio.get(
      '/flupflap/mobile-topups/operators/${operator['id']}/products',
      queryParameters: {'country': destination},
    );
    if (alive) {
      setState(() {
        products = (response.data['products'] as List)
            .map(
              (e) => <String, dynamic>{
                ...Map<String, dynamic>.from(e as Map),
                'operatorId': operator['id'],
              },
            )
            .toList();
        product = null;
      });
    }
  });
  Future<void> reviewPrice() => run(() async {
    if (product == null) return;
    final response = await dio.post(
      '/flupflap/stores/quotes',
      data: {
        'countryCode': destination,
        'phone': fields[4].text.trim(),
        'operatorId': product!['operatorId'],
        'productId': product!['id'],
        if (product!['catalogVersion'] != null)
          'catalogVersion': product!['catalogVersion'],
        if (product!['amountType'] == 'RANGE')
          'amount': double.tryParse(fields[5].text),
      },
    );
    if (alive) {
      setState(() {
        quote = Map<String, dynamic>.from(response.data['quote'] as Map);
      });
    }
  });
  Future<void> purchase() => run(() async {
    if (quote == null) return;
    // Stable for this quote, including network failures and retries.
    uncertain = true;
    final response = await dio.post(
      '/flupflap/stores/purchases',
      data: {'quoteId': quote!['id']},
      options: Options(headers: {'Idempotency-Key': 'store:${quote!['id']}'}),
    );
    if (!alive) return;
    setState(() {
      transaction = Map<String, dynamic>.from(
        response.data['transaction'] as Map,
      );
      uncertain = false;
    });
    await load();
    if (!terminal) scheduleRefresh();
  });
  bool get terminal =>
      transaction != null &&
      ['DELIVERED', 'FAILED', 'REFUNDED'].contains(transaction!['status']) &&
      [
        'CAPTURED',
        'FAILED',
        'REFUNDED',
        'VOIDED',
      ].contains(transaction!['paymentStatus']);
  void scheduleRefresh() {
    timer?.cancel();
    timer = Timer(const Duration(seconds: 5), () async {
      if (!alive || transaction == null) return;
      await refreshSale();
      if (alive && !terminal) scheduleRefresh();
    });
  }

  Future<void> refreshSale() => run(() async {
    final response = await dio.get(
      '/flupflap/mobile-topups/transactions/${transaction!['id']}',
      queryParameters: {'refresh': 'true'},
    );
    if (alive) {
      setState(() {
        transaction = Map<String, dynamic>.from(
          response.data['transaction'] as Map,
        );
      });
    }
    await load();
  });
  void nextSale() => setState(() {
    quote = null;
    transaction = null;
    products = [];
    product = null;
    fields[4].clear();
    fields[5].clear();
  });

  @override
  Widget build(BuildContext context) {
    if (!alive) {
      return const Scaffold(
        body: Center(
          child: Text('Sign in to your registered FlupFlap account.'),
        ),
      );
    }
    final store = data?['store'] as Map?;
    return Scaffold(
      appBar: AppBar(
        title: const FlupFlapPageTitle('Store seller'),
        actions: [
          IconButton(
            onPressed: busy ? null : refresh,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 680),
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              if (busy) const LinearProgressIndicator(),
              if (error != null)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text(
                    error!,
                    style: const TextStyle(color: Colors.red),
                  ),
                ),
              if (data?['testMode'] == true)
                const Text('Test store — balances are simulated.'),
              if (data == null && !busy)
                const Text('Refresh to check store seller availability.'),
              if (data != null && store == null) ...[
                const Text(
                  'Sell FlupFlap Recharge in your store',
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                ),
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 16),
                  child: Text(
                    'Apply for a store account. Once approved, add funds and send airtime or internet plans for customers. Starting commission: 20% of the service fee on delivered sales.',
                  ),
                ),
                Form(
                  key: form,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      input(0, 'Store name'),
                      input(1, 'Contact name'),
                      input(2, 'Store phone, including +country code'),
                      input(3, 'Store street address and city'),
                      countryButton(true),
                      FilledButton(
                        onPressed: busy ? null : apply,
                        child: const Text('Apply for store account'),
                      ),
                    ],
                  ),
                ),
              ],
              if (store != null) ...[
                Text(
                  '${store['name']}',
                  style: const TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text('Status: ${store['status']}'),
                Text(
                  'Available balance: ${money(store['balanceCents'])} USD',
                  style: const TextStyle(fontSize: 22),
                ),
                Text(
                  'Earned on delivered sales: ${money(data?['earnedCents'])} USD',
                ),
                Text(
                  'Your commission: ${(store['commissionBps'] as num) / 100}% of the service fee',
                ),
                const Text(
                  'Balances and receipts are in USD. Confirm the full price with your customer before sending.',
                ),
                if (data?['canSell'] != true)
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text(
                      'Sales and deposits will be available after store and country activation.',
                    ),
                  ),
                if (data?['canSell'] == true) ...[
                  const Divider(height: 32),
                  const Text(
                    'Add funds',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  const Text(
                    'Contact contact@ticash-app.com for approved deposit instructions. Submit the transfer reference after sending funds. An admin verifies receipt before crediting your balance.',
                  ),
                  input(6, 'Deposit amount in USD', number: true),
                  input(7, 'Bank or payment transfer reference'),
                  OutlinedButton(
                    onPressed: busy
                        ? null
                        : () => run(() async {
                            final amount = double.tryParse(fields[6].text);
                            if (amount == null ||
                                amount < 1 ||
                                amount > 10000 ||
                                (amount * 100 - (amount * 100).round()).abs() >
                                    0.00001) {
                              throw const FormatException();
                            }
                            await dio.post(
                              '/flupflap/stores/funding',
                              data: {
                                'amountCents': (amount * 100).round(),
                                'reference': fields[7].text.trim(),
                              },
                            );
                            await load();
                          }),
                    child: const Text('Submit deposit for verification'),
                  ),
                  const Divider(height: 32),
                  const Text(
                    'New customer recharge',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  if (quote == null && transaction == null) ...[
                    countryButton(false),
                    input(4, 'Family member’s phone number'),
                    OutlinedButton(
                      onPressed: busy ? null : findProducts,
                      child: const Text('Find airtime and internet plans'),
                    ),
                    for (final plan in products)
                      InternetBundleCard(
                        product: MobileTopUpProduct.fromJson(plan),
                        selected: product?['id'] == plan['id'],
                        detailLabel: (value) => value,
                        onSelected: busy ? null : () => setState(() {
                          product = plan;
                        }),
                      ),
                    if (product?['amountType'] == 'RANGE')
                      input(5, 'Recharge amount in USD', number: true),
                    if (product != null)
                      FilledButton(
                        onPressed: busy ? null : reviewPrice,
                        child: const Text('Review customer price'),
                      ),
                  ],
                  if (quote != null && transaction == null) ...[
                    Text(
                      'Send to ${quote!['recipientPhone']} · ${quote!['operatorName']}',
                    ),
                    Text('${quote!['productName']}'),
                    Text(
                      'Recharge: ${money(((quote!['providerAmount'] as num) * 100).round())} USD',
                    ),
                    Text(
                      'Service fee: ${money(((quote!['feeUsd'] as num) * 100).round())} USD',
                    ),
                    Text(
                      'Customer total: ${money(((quote!['totalChargeUsd'] as num) * 100).round())} USD',
                      style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    if (quote!['receiverQuote'] is Map)
                      Text(
                        'Recipient receives: ${quote!['receiverQuote']['amount']} ${quote!['receiverQuote']['currency']}',
                      ),
                    const Text(
                      'Confirm the phone number and collect customer payment before sending.',
                    ),
                    FilledButton(
                      onPressed: busy ? null : purchase,
                      child: Text(
                        uncertain
                            ? 'Check / retry this same sale'
                            : 'Send using store balance',
                      ),
                    ),
                    if (!uncertain)
                      TextButton(
                        onPressed: busy
                            ? null
                            : () => setState(() {
                                quote = null;
                              }),
                        child: const Text('Change recharge'),
                      ),
                  ],
                ],
                if (transaction != null) ...[
                  Text('Receipt: ${transaction!['id']}'),
                  Text('Recipient: ${transaction!['recipientPhone']}'),
                  Text('Recharge: ${transaction!['productName']}'),
                  Text(
                    'Total: ${money(((transaction!['totalChargeUsd'] as num) * 100).round())} USD',
                  ),
                  Text(
                    'Delivery: ${transaction!['status']} · Payment: ${transaction!['paymentStatus']}',
                  ),
                  if (transaction!['status'] == 'DELIVERED')
                    const Text(
                      'Recharge delivered. Your commission has been credited to your store balance.',
                    ),
                  if (!terminal)
                    const Text(
                      'This sale is still being confirmed. Keep this receipt and refresh its status.',
                    ),
                  OutlinedButton(
                    onPressed: busy ? null : refreshSale,
                    child: const Text('Refresh sale'),
                  ),
                  if (terminal)
                    FilledButton(
                      onPressed: busy ? null : nextSale,
                      child: const Text('Start next customer sale'),
                    ),
                ],
                const Divider(height: 32),
                const Text(
                  'Recent sales and receipts',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                ),
                for (final item in (data?['orders'] as List? ?? []))
                  ListTile(
                    title: Text(
                      '${item['transaction']['recipientPhone']} · ${item['transaction']['productName']}',
                    ),
                    subtitle: Text(
                      '${item['transaction']['status']} · ${money(item['totalCents'])} USD\nReceipt: ${item['transactionId']}\nCommission: ${money(item['commissionCents'])} USD · ${item['status']}',
                    ),
                    onTap: busy
                        ? null
                        : () => run(() async {
                            final response = await dio.get(
                              '/flupflap/mobile-topups/transactions/${item['transactionId']}',
                              queryParameters: {'refresh': 'true'},
                            );
                            if (alive) {
                              setState(() {
                                transaction = Map<String, dynamic>.from(
                                  response.data['transaction'] as Map,
                                );
                              });
                            }
                            if (!terminal) scheduleRefresh();
                            await load();
                          }),
                  ),
                const Text(
                  'Recent deposits',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                ),
                for (final item in (data?['funding'] as List? ?? []))
                  ListTile(
                    title: Text(
                      '${money(item['amountCents'])} USD · ${item['status']}',
                    ),
                    subtitle: Text('${item['reference']}'),
                  ),
                const Text(
                  'Balance history',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                ),
                for (final item in (data?['entries'] as List? ?? []))
                  ListTile(
                    title: Text(
                      '${item['kind']}: ${money(item['amountCents'])} USD',
                    ),
                    subtitle: Text(
                      'Balance: ${money(item['balanceAfterCents'])} USD · ${item['createdAt']}',
                    ),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
