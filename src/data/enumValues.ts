export const ENUM_VALUES: Record<string, unknown[]> = {
  gender:['男','女','未知'], zodiac:['鼠','牛','虎','兔','龙','蛇','马','羊','猴','鸡','狗','猪'], constellation:['白羊座','金牛座','双子座','巨蟹座','狮子座','处女座','天秤座','天蝎座','射手座','摩羯座','水瓶座','双鱼座'],
  memberLevel:['普通','白银','黄金','黑金'], timezone:['Asia/Shanghai','Asia/Tokyo','Europe/London','America/New_York'], locale:['zh-CN','en-US','ja-JP'], language:['中文','English','日本語'],
  httpMethod:['GET','POST','PUT','PATCH','DELETE'], httpStatus:[200,201,204,400,401,403,404,409,422,500], contentType:['application/json','multipart/form-data','text/plain','application/xml'], os:['macOS','Windows 11','Ubuntu','iOS','Android'], browser:['Chrome','Safari','Edge','Firefox'],
  currency:['CNY','USD','EUR','JPY','HKD'], bank:['工商银行','建设银行','招商银行','中国银行','浦发银行'], riskLevel:['低风险','中风险','高风险'], transactionType:['收入','支出','转账','退款'], transactionStatus:['处理中','成功','失败','已撤销'],
  userStatus:['正常','冻结','注销','待激活'], accountType:['个人','企业','测试'], productCategory:['数码','服饰','食品','家居','运动'], brand:['云杉','北辰','逐光','原野','墨石'], specification:['标准版','轻享版','专业版','旗舰版'], unit:['件','套','盒','台','kg'],
  orderStatus:['待支付','已支付','待发货','已发货','已签收','已退款'], paymentMethod:['微信支付','支付宝','银行卡','余额'], logisticsStatus:['已揽收','运输中','到达网点','派送中','已签收'], gameClass:['战士','法师','游侠','牧师','刺客'], equipmentQuality:['普通','精良','稀有','史诗','传说'], questStatus:['未领取','进行中','已完成','已领奖'],
  approvalStatus:['待审批','已通过','已驳回','已撤销'], priority:['P0','P1','P2','P3'], serverName:['晨曦之地','风暴峡谷','星海边境','永夜之城'], itemName:['生命药水','秘银长剑','星尘宝箱','传送卷轴'], reportReason:['垃圾广告','侵权','辱骂','虚假信息'], batchStatus:['待执行','执行中','成功','部分失败','失败'], boolean:[true,false], taxRate:[0,0.03,0.06,0.09,0.13],
}
