import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

import 'approved_recharge_design_test.dart' as approved;

// Exercise the same provider-driven layout and checkout assertions with iOS
// platform behavior, including text fields, navigation and responsive sizes.
void main() {
  approved.main(platformVariant: TargetPlatformVariant.only(TargetPlatform.iOS));
}
